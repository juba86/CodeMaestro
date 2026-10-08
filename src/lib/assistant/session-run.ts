import { prisma } from "@/lib/db/client";
import { augmentPromptWithKnowledge } from "@/lib/knowledge/retrieve";
import { abortRun, beginRun, endRun, monotonicNow, type HubEvent, type RunHandle, type RunKind, type RunOrigin } from "./run-hub";
import { denyAllPending } from "./approvals";
import { runTurn, stopSession, type AssistantSessionRow, type NormalizedEvent } from "./runner";
import { TranscriptWriter } from "./transcript";
import { notifySession } from "@/lib/push";

export type DbSession = NonNullable<Awaited<ReturnType<typeof prisma.assistantSession.findUnique>>>;

/** Maps a DB session onto the runner's row shape. */
export function toSessionRow(session: DbSession, extra: Partial<AssistantSessionRow> = {}): AssistantSessionRow {
  return {
    id: session.id,
    externalId: session.externalId,
    provider: session.provider,
    model: session.model,
    cwd: session.cwd,
    permissionMode: session.permissionMode,
    allowedTools: session.allowedTools,
    approvalMode: session.approvalMode,
    sandbox: session.sandbox,
    ...extra,
  };
}

export interface RunContext {
  sessionId: string;
  runId: string;
  signal: AbortSignal;
  publish: (e: HubEvent) => void;
  writer: TranscriptWriter;
}

export interface RunOutcome {
  isError: boolean;
}

export interface UserMessage {
  content: string;
  /** JSON string stored with the row. */
  meta?: string;
}

/**
 * Persists a user-authored row. `at` must lie before the run's `startedAt`:
 * GET /sessions/[id] cuts the transcript at the run start and the client
 * replays the run from there, so a later timestamp would hide the row.
 *
 * Prefer `launchRun({ userMessage })`, which persists only after the session
 * was claimed — calling this first leaves an orphaned row when the start then
 * fails with SessionBusyError.
 */
export async function persistUserMessage(
  sessionId: string,
  content: string,
  meta = "{}",
  at = monotonicNow()
): Promise<void> {
  await prisma.assistantMessage.create({
    data: { sessionId, role: "user", content, meta, createdAt: new Date(at) },
  });
}

/**
 * Starts server-side work for a session and returns immediately. The work runs
 * detached from any HTTP request: clients attach via SSE (/events) and may come
 * and go. Throws SessionBusyError if the session already has an active run.
 *
 * Lifecycle: the session is claimed (one run per session), `userMessage` is
 * persisted, status → "running" in the DB, `work` executes, transcript rows
 * are flushed, open approvals/questions are denied, status → idle/error,
 * `run_end` is published (status "stopped" when the run was aborted).
 */
export async function launchRun(opts: {
  sessionId: string;
  kind: RunKind;
  origin: RunOrigin;
  title?: string;
  /** The user's prompt row; written only once the session is claimed. */
  userMessage?: UserMessage;
  work: (ctx: RunContext) => Promise<RunOutcome>;
}): Promise<RunHandle> {
  const { sessionId } = opts;
  // Claim first, persist second: a concurrent start then fails here with
  // SessionBusyError before writing anything, instead of leaving a user row
  // that never ran. The row keeps a timestamp taken *before* the claim, so it
  // still sorts strictly before run.startedAt (GET cut-off and SSE replay).
  const userAt = monotonicNow();
  const handle = beginRun(sessionId, opts.kind, opts.origin);
  const runId = handle.info.runId;

  try {
    if (opts.userMessage) {
      await persistUserMessage(sessionId, opts.userMessage.content, opts.userMessage.meta, userAt);
    }
    const current = await prisma.assistantSession.findUnique({ where: { id: sessionId }, select: { title: true } });
    await prisma.assistantSession.update({
      where: { id: sessionId },
      data: { status: "running", ...(opts.title && !current?.title ? { title: opts.title.slice(0, 80) } : {}) },
    });
  } catch (err) {
    endRun(sessionId, runId, "error", { error: "Session konnte nicht gestartet werden." });
    throw err;
  }

  const writer = new TranscriptWriter(sessionId);
  const ctx: RunContext = { sessionId, runId, signal: handle.signal, publish: handle.publish, writer };

  void (async () => {
    let isError = true;
    try {
      ({ isError } = await opts.work(ctx));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ausführung fehlgeschlagen";
      ctx.publish({ type: "error", content: msg });
      writer.add({ role: "error", content: msg.slice(0, 4000) });
    }
    const stopped = handle.signal.aborted;
    if (stopped) writer.add({ role: "system", content: "⏹ Ausführung gestoppt." });
    try { await writer.close(); } catch { /* logged by the writer */ }
    const status = stopped ? "stopped" : isError ? "error" : "idle";
    try {
      await prisma.assistantSession.update({
        where: { id: sessionId },
        data: { status: status === "error" ? "error" : "idle" },
      });
    } catch (err) {
      console.error("[launchRun] status update failed", err);
    }
    // The CLIs of this run are gone (even when one crashed without a Stop), so
    // nobody will consume a decision: deny what is still open. Otherwise the
    // cards leak into the next run's snapshot (listPending) and the activity
    // API. Synchronously right before endRun: the resolutions land in this
    // run's buffer and no approval can be created in between.
    denyAllPending(sessionId, "Lauf beendet.");
    void notifySession(sessionId, "run_end", { status, title: opts.title }); // before endRun: run_end detaches live SSE listeners
    endRun(sessionId, runId, status);
  })();

  return handle;
}

/**
 * Stops a session's run: aborts multi-step work, kills every CLI child, and
 * denies open approvals so a blocked hook returns immediately.
 */
export function stopRunNow(sessionId: string): { stopped: boolean } {
  const aborted = abortRun(sessionId);
  const killed = stopSession(sessionId);
  denyAllPending(sessionId);
  return { stopped: aborted || killed };
}

export interface TurnOptions {
  apiKey?: string;
  useKnowledge?: boolean;
  /** Surface AskUserQuestion/ExitPlanMode as clickable cards (live clients). */
  interactive?: boolean;
  /** Extra metadata merged into the session row (e.g. a fresh context). */
  rowOverrides?: Partial<AssistantSessionRow>;
  /** Observe runner events (Telegram mirrors them into the chat). */
  onEvent?: (e: NormalizedEvent) => void;
}

export interface TurnOutcome extends RunOutcome {
  costUsd: number;
  /** The CLI's final result text (or the streamed text when none). */
  resultText: string;
  externalId: string | null;
}

/**
 * Runs one CLI turn inside a run context: optional RAG augmentation, live
 * events into the hub, progressive transcript persistence, and the session's
 * resume id + cost bookkeeping.
 */
export async function executeTurn(ctx: RunContext, prompt: string, opts: TurnOptions = {}): Promise<TurnOutcome> {
  const session = await prisma.assistantSession.findUnique({ where: { id: ctx.sessionId } });
  if (!session) throw new Error("Session nicht gefunden.");

  let streamed = "";
  let finalResult = "";
  const emit = (e: NormalizedEvent) => {
    if (e.type === "done") return; // run-level end is signalled by run_end
    if (e.type === "text" && e.content) streamed += e.content;
    if (e.type === "result" && typeof e.content === "string") finalResult = e.content;
    ctx.publish(e as unknown as HubEvent);
    ctx.writer.record(e);
    opts.onEvent?.(e);
  };

  // RAG: prepend relevant knowledge-base context (shared retrieval path).
  // Graceful — never blocks the turn. Only the model sees the augmented prompt.
  let effectivePrompt = prompt;
  if (opts.useKnowledge) {
    try {
      const aug = await augmentPromptWithKnowledge(prompt, { enabled: true });
      if (aug.injected) {
        effectivePrompt = aug.prompt;
        emit({ type: "knowledge", sources: aug.sources.map((s) => s.docTitle) });
      }
    } catch { /* RAG is best effort */ }
  }

  const row = toSessionRow(session, { interactive: !!opts.interactive, ...opts.rowOverrides });
  const result = await runTurn(row, effectivePrompt, opts.apiKey, emit, { signal: ctx.signal });
  ctx.writer.flushText();

  const keepContext = opts.rowOverrides?.externalId === undefined;
  try {
    await prisma.assistantSession.update({
      where: { id: ctx.sessionId },
      data: {
        ...(keepContext && result.externalId && result.externalId !== session.externalId
          ? { externalId: result.externalId }
          : {}),
        totalCostUsd: { increment: result.costUsd || 0 },
      },
    });
  } catch (err) {
    // A clash on the unique externalId must not wedge the session.
    console.error("[executeTurn] session bookkeeping failed", err);
    await prisma.assistantSession
      .update({ where: { id: ctx.sessionId }, data: { totalCostUsd: { increment: result.costUsd || 0 } } })
      .catch(() => {});
  }

  return {
    isError: result.isError,
    costUsd: result.costUsd,
    resultText: finalResult || streamed,
    externalId: result.externalId,
  };
}
