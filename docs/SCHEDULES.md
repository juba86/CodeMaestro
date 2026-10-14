# Schedules — sessions that work on their own

A **schedule** (German UI: „Zeitplan“) attaches a recurring job to a session:
a task the session's agent runs by itself — on a cron rhythm, when a webhook
is called, or by hand — and whose outcome is reported back by push or
Telegram. With a schedule, a session becomes an unattended agent: a nightly
test run, an hourly review of new commits, a weekly dependency audit, a docs
sync that only runs when the code changed.

```
scheduler.ts (30 s tick) ──► tickSchedules() ──► fireSchedule() ──► launchRun / startLoopRun / orchestrateRun
POST /schedules/[id]/run  ──────────────────────┘                           │ origin "schedule" | "webhook"
POST /schedules/trigger/[token] ────────────────┘                           ▼
                                                              handle.finished ──► finishRun(): status, report, fingerprint,
                                                                                  fail streak, run cap, push / Telegram
```

## What a schedule holds

| Field | Meaning |
|---|---|
| `name`, `prompt` | The job and its task. The task is the user message of every run. |
| `cron` | Five fields (`Minute Stunde Tag Monat Wochentag`) in the **server's local time**; `""` = no time trigger (webhook only). Presets cover the common rhythms; the editor describes any expression in German and shows the next three times. |
| `mode` | `turn` (one pass of the session's agent), `loop` (the loop protocol with its own options) or `orchestrate` (the saved orchestra). |
| `onlyIfChanged` | A cron run is skipped while the working tree's fingerprint (HEAD plus dirty files, measured with git) equals the one measured after the last run. Manual and webhook runs always go. |
| `onBusy` | What a cron run does when the session is busy: `skip` (next slot) or `wait` (stays due and starts as soon as the session is free). |
| `notifyPush`, `notifyTelegram` | Where the outcome goes. Push always sends (the user asked for it); Telegram goes to every allowed chat of the bridge. |
| `maxRuns` | Switches the schedule off after that many runs. |
| `triggerToken` | The secret of the webhook URL. |

Bookkeeping per schedule: `runCount`, `failStreak`, `lastRunAt`, `lastStatus`
(`running · done · error · stopped · skipped · unchanged · paused`),
`lastSummary` (the agent's closing report, clipped), `lastFingerprint`,
`nextRunAt`.

## How a run behaves

- Every run is an ordinary **hub run** of the session (see
  [ASSISTANT_RUNS.md](./ASSISTANT_RUNS.md)) with origin `schedule` or
  `webhook`: it shows up in the session list and the activity center, streams
  into the thread, can be stopped, and is subject to the session's permission
  mode, tool allowlist, approval gate and sandbox.
- The agent's prompt starts with a `<schedule>` block (`src/lib/schedule/prompt.ts`):
  which schedule started it, the run number, the trigger and time; that nobody
  is watching, so it must not ask questions; and that it must end with a short
  report whose first line is a one-sentence headline. The transcript shows the
  task itself; the block is only sent to the agent.
- A webhook body (JSON or text, up to 8,000 characters) is handed over inside
  `<trigger_payload>` — a GitHub push event, a CI failure, an alert.
- When the run ends, the newest assistant/synthesis text written during the
  run becomes the report; its headline is the notification body.
- **Three failed runs in a row pause the schedule** (`paused`); switching it
  back on resets the streak. `maxRuns` reached disables it. A run that cannot
  start (session deleted, folder gone) counts as a failure too.
- One run per session at a time: a webhook or manual start on a busy session
  answers `409`.

## API

| Route | Purpose |
|---|---|
| `GET /api/assistant/schedules[?session=<id>]` | All schedules (home widget) or one session's. |
| `POST /api/assistant/schedules` | `{ sessionId, name, prompt, cron, mode, loop, useKnowledge, onBusy, onlyIfChanged, notifyPush, notifyTelegram, maxRuns, enabled }` → `201 { schedule }`. At most 20 per session. |
| `PATCH /api/assistant/schedules/[id]` | Partial update; changing `cron` or `enabled` recomputes `nextRunAt`. |
| `DELETE /api/assistant/schedules/[id]` | Remove (runs stay in the session's transcript). |
| `POST /api/assistant/schedules/[id]/run` | Run now (also when switched off) → `202 { runId }`. |
| `POST /api/assistant/schedules/trigger/[token]` | Webhook: starts an enabled schedule with the body as payload → `202 { runId, sessionId }`; `404` unknown token, `409` busy or disabled. |

Webhook example:

```bash
curl -X POST "https://<machine>.<tailnet>.ts.net/api/assistant/schedules/trigger/<token>" \
  -H "Content-Type: application/json" \
  -d '{"source":"ci","job":"build","status":"failed","url":"https://ci.example/run/42"}'
```

The token is the only credential. Non-browser callers pass the CSRF guard
(`src/proxy.ts`); the optional Tailscale identity allowlist
(`CODEMAESTRO_TAILSCALE_USERS`) still applies, so callers outside the tailnet
need the app exposed to them deliberately. Treat the URL like a password:
„Webhook-URL kopieren“ in the schedule's menu hands it out, editing the
schedule shows it.

## Files

| File | Role |
|---|---|
| `src/lib/schedule/cron.ts` | Cron parser, next-run computation, German descriptions, presets. |
| `src/lib/schedule/schedules.ts` | Rows, firing, outcome bookkeeping, notifications, the tick. |
| `src/lib/schedule/scheduler.ts` | The 30 s timer on `globalThis`, started in `src/instrumentation.ts`. |
| `src/lib/schedule/prompt.ts` | The `<schedule>` block. |
| `src/lib/schedule/templates.ts` | Ready-made jobs offered in the editor. |
| `src/components/assistant/schedules.tsx` | Inspector tab „Zeitpläne“ and the editor sheet. |
| `src/components/home/schedules-widget.tsx` | Home widget with the upcoming runs. |

Limits: schedules tick every 30 s (a cron minute is never missed, but a run
starts up to 30 s after its minute); times are the server's local zone; a
server restart ends running jobs like any run (they are recorded as
`stopped`) and the next tick resumes the timetable.
