import { prisma } from "@/lib/db/client";
import { augmentPromptWithKnowledge } from "@/lib/knowledge/retrieve";
import { abortRun, beginRun, endRun, monotonicNow, type HubEvent, type RunHandle, type RunKind, type RunOrigin } from "./run-hub";
import { denyAllPending } from "./approvals";
import { runTurn, stopSession, type AssistantSessionRow, type NormalizedEvent } from "./runner";
import { TranscriptWriter } from "./transcript";

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

/** Persists a user-authored row with a timestamp strictly before the run starts. */
export async function persistUserMessage(sessionId: string, content: string, meta = "{}"): Promise<void> {
  await prisma.assistantMessage.create({
    data: { sessionId, role: "user", content, meta, createdAt: new Date(monotonicNow()) },
  });
}

/**
 * Starts server-side work for a session and returns immediately. The work runs
 * detached from any HTTP request: clients attach via SSE (/events) and may come
 * and go. Throws SessionBusyError if the session already has an active run.
 *
 * Lifecycle: status → "running" in the DB, `work` executes, transcript rows are
 * flushed, status → idle/error, `run_end` is published (status "stopped" when
 * the run was aborted).
 */
export async function launchRun(opts: {
  sessionId: string;
  kind: RunKind;
  origin: RunOrigin;
  title?: string;
  work: (ctx: RunContext) => Promise<RunOutcome>;
}): Promise<RunHandle> {
  const handle = beginRun(opts.sessionId, opts.kind, opts.origin);
  const { sessionId } = opts;
  const runId = handle.info.runId;

  try {
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
