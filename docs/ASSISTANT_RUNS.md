# Assistant runs — how work survives a closed window

Every piece of assistant work — a single turn, an orchestration, a loop, or a
turn started from Telegram — is a **run** that lives on the server, not in an
HTTP request. Browsers only *watch* runs. Closing the window, mobile standby, a
reload or a flaky network never interrupts the work and never loses events,
pending approvals or questions.

```
POST /message | /orchestrate | /orchestrate/run | /loop   → 202 { runId }
                     │
                     ▼
            launchRun (session-run.ts) ── work(ctx) runs detached
                     │   publish(event) ──► run hub (run-hub.ts, globalThis)
                     │   writer.record() ──► SQLite transcript (ordered, progressive)
                     ▼
GET /events?since=N  ◄── SSE: replay buffered events after N, then live, until run_end
```

## Building blocks

| File | Role |
|---|---|
| `src/lib/assistant/run-hub.ts` | Process-wide registry: one run per session, an event buffer with sequence numbers, listeners, abort signal, SSE transport (`id:` per event, heartbeats, `Last-Event-ID` resume). Kept on `globalThis` because route handlers and the instrumentation hook (Telegram auto-start) live in different Next.js module graphs. |
| `src/lib/assistant/session-run.ts` | `launchRun` (status → running, detached work, transcript flush, status → idle/error, `run_end`), `executeTurn` (RAG + CLI turn + bookkeeping), `stopRunNow`. |
| `src/lib/assistant/transcript.ts` | Writes transcript rows *while* the run streams, in order (strictly increasing timestamps), interleaving text and tool calls as they happened. |
| `src/lib/assistant/approvals.ts` | Approvals and interactive questions are published into the run — any client that attaches later still sees them. The PreToolUse hook creates a request, then long-polls `/approval/[id]/wait`; the wait outlasts a closed window (default 30 min, `ASSISTANT_APPROVAL_TIMEOUT_SEC`). |
| `src/lib/assistant/runner.ts` | Spawns the CLI per turn (process groups, killable as a whole), parses `stream-json`, fails closed when the approval hook is missing. |

## Client protocol

1. `GET /api/assistant/sessions/:id` → `{ session, run }`. While a run is
   active, `session.messages` stops at the run start and `run.attachFrom` says
   where to replay from (0, or `lastSeq` for very long runs whose buffer was
   trimmed). `run.pending` lists open approvals/questions.
2. `new EventSource('/api/assistant/sessions/:id/events?since=' + attachFrom)`.
   The browser reconnects by itself and sends `Last-Event-ID`, so nothing is
   replayed twice.
3. On `run_end` (or `idle` when nothing runs): close the stream and reload the
   session — the transcript is now complete in the database.

## Event types

`run_start`, `run_end {status: idle|error|stopped}`, `idle`, turn events
(`init`, `text`, `thinking`, `tool_use`, `tool_result`, `result`, `error`,
`knowledge`, `notice`), approvals (`approval_request`, `approval_resolved`,
`question_request`, `question_resolved`), orchestrator (`log`, `plan`,
`subtask_start`, `subtask_text`, `subtask_end`, `synthesis`) and loop
(`loop_iteration`, `loop_wait`, `loop_end`).

## Guarantees and limits

- One run per session; a second start gets `409 SESSION_BUSY`.
- Stop aborts multi-step runs between steps, kills every CLI process of the
  session (including shells they spawned) and denies open approvals.
- A server restart ends all runs (CLI processes do not survive it); the boot
  hook resets stale `running` statuses. Everything already streamed is in the
  transcript.
- The event buffer holds the last 5,000 events per run (oversized payloads are
  clipped); finished runs stay attachable for 60 s.

## Questions and permission prompts

`claude -p` has no one to ask: without a permission host it denies every tool
call that would need a prompt (a Bash command outside the allowed tools, …)
and does not even offer AskUserQuestion or ExitPlanMode — Claude then asks in
plain text ("Ich warte auf die Freigabe …", "A, B oder C?") and the run is
stuck. Interactive runs (PWA and Telegram turns, loops, orchestrator subtasks
that change files) therefore start Claude Code with
`--mcp-config <file> --permission-prompt-tool mcp__codemaestro__permission`
(`scripts/assistant-permission-mcp.mjs`, a stdio MCP server using the same
create + long-poll bridge as the PreToolUse hook):

- AskUserQuestion becomes a question card with options and „Eigene Antwort“;
  the answer goes back to Claude, which continues in the same run.
- ExitPlanMode becomes a plan card (approve / revise with a hint).
- A tool call that needs permission becomes an approval card instead of a
  silent deny; a denial with a hint tells Claude what to do instead.
- The MCP config file (0600) carries the bridge's token, never the command
  line; `MCP_TOOL_TIMEOUT` is raised above the approval timeout.

Unattended runs (read-only orchestrator workers, planning, reviews, the
summary) keep the silent deny; denied tool calls are reported as a `notice`
row ("Ohne Freigabe blockiert …") so a "waiting for approval" has a visible
cause.

## Continuing the conversation

- Every turn resumes the session's Claude Code conversation (`--resume <id>`).
  If that conversation is gone for the working directory, the turn says so
  and starts a new one instead of failing.
- „Neue Session“ lists the folder's earlier Claude Code conversations
  (`GET /api/assistant/claude-sessions?cwd=…`, read from
  `${CLAUDE_CONFIG_DIR:-~/.claude}/projects/`) and preselects the newest; the
  session is created on it (`resumeSessionId`), so the first turn resumes it.
  A conversation already linked to a session opens that session instead.
- Orchestrations continue it too: a Claude Code planner and Claude Code
  workers of a Claude Code session run on a fork of the conversation
  (`--resume <id> --fork-session --no-session-persistence`), so „mach weiter“
  works and the session's own thread stays clean. Reviews and the summary run
  fresh.
- The orchestration's summary is handed over: the session's next turn starts
  with a `<context>` block holding it (once; marked `handoff: done` on the
  synthesis row), so answering a question from the summary just works. Further
  orchestrations see pending summaries as well.

## Team sync: agents know what the others did

Agents do not share a conversation: each session keeps its own, and orchestra
workers start empty. Three mechanisms keep them aligned.

| Scope | Mechanism | File |
|---|---|---|
| Subtasks of one orchestration | Each agent ends with a `## Handoff` section; the next one gets it for all earlier subtasks (dependencies in detail), with the files each subtask changed and the review outcome. Sized to the receiving model's context window. | `handoff.ts`, `workdir-changes.ts` |
| An orchestration → the session's own agent | The conductor's summary is prepended to the session's next turn, once. | `session-run.ts` (`pendingHandoffs`) |
| Sessions and agents on the same working directory | The **work journal** (`WorkLogEntry`): every turn or orchestration that changed files leaves an entry (agent, task, closing report, changed files, status). A turn starts with the entries of *other* sessions newer than the session's `syncedAt` (at most 5, on first contact the last 14 days) and a warning when another session has a run in the same directory right now. `syncedAt` only advances when the turn succeeded. Orchestra workers additionally get the session's own last entries unless they continue its conversation (a Claude Code worker in a Claude Code session). | `work-journal.ts` |

Limits: sessions are matched by the exact working directory (a session in a
subdirectory is a different project); file changes are measured with git, so
outside a repository an entry is written whenever the agent reported
something; and the sync happens at the start of a turn — an agent that is
already working is not interrupted when another one finishes.

