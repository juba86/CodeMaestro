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
`knowledge`), approvals (`approval_request`, `approval_resolved`,
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
