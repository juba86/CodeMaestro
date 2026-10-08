import { prisma } from "@/lib/db/client";
import { augmentPromptWithKnowledge } from "@/lib/knowledge/retrieve";
import { abortRun, beginRun, endRun, monotonicNow, type HubEvent, type RunHandle, type RunKind, type RunOrigin } from "./run-hub";
import { denyAllPending } from "./approvals";
import { runTurn, stopSession, type AssistantSessionRow, type NormalizedEvent } from "./runner";
import { HANDOFF_DONE, HANDOFF_PENDING, TranscriptWriter } from "./transcript";
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

export interface Handoff {
  id: string;
  task: string;
  summary: string;
}

const pendingHandoffWhere = (sessionId: string) => ({
  sessionId,
  role: "synthesis",
  meta: { contains: `"handoff":"${HANDOFF_PENDING}"` },
});

/** Orchestration summaries the session's agent conversation has not seen yet (oldest first, at most 3). */
export async function pendingHandoffs(sessionId: string): Promise<Handoff[]> {
  const rows = await prisma.assistantMessage.findMany({
    where: pendingHandoffWhere(sessionId),
    orderBy: { createdAt: "desc" },
    take: 3,
    select: { id: true, content: true, meta: true },
  });
  return rows.reverse().map((r) => {
    let task = "";
    try {
      const meta = JSON.parse(r.meta || "{}") as { task?: unknown };
      if (typeof meta.task === "string") task = meta.task;
    } catch { /* malformed meta: summary only */ }
    return { id: r.id, task, summary: r.content };
  });
}

/**
 * The prompt with what happened since the agent's last reply: orchestrations
 * ran in forks of its conversation, so without this "mach weiter" or an
 * answer to a question from the summary would reach an agent that knows
 * nothing about them.
 */
export function withHandoffs(prompt: string, handoffs: Handoff[]): string {
  return handoffs.length ? `${handoffBlock(handoffs)}\n\n${prompt}` : prompt;
}

/** The <context> block of withHandoffs ("" without handoffs). */
export function handoffBlock(handoffs: Handoff[]): string {
  if (!handoffs.length) return "";
  const blocks = handoffs
    .map((h) => `<orchestration>\n${h.task ? `<task>\n${h.task}\n</task>\n` : ""}<summary>\n${h.summary}\n</summary>\n</orchestration>`)
    .join("\n");
  return `<context>
Since your last reply, CodeMaestro ran ${handoffs.length === 1 ? "an orchestration" : "orchestrations"} in this project: other agents worked on the task and may have changed files on disk. Their summary is below; the user's message follows and may answer questions from it.
${blocks}
</context>`;
}

/**
 * The context block of the session's pending handoffs, for an orchestration:
 * its planner and workers continue a fork of the conversation that has not
 * seen earlier orchestrations either (e.g. the user answers a question from
 * the last summary with the orchestrator still on). They stay pending — the
 * session's own conversation still has to be told.
 */
export async function pendingHandoffContext(sessionId: string): Promise<string> {
  return handoffBlock(await pendingHandoffs(sessionId).catch(() => [] as Handoff[]));
}

/**
 * Ids of every pending handoff of the session — also the older ones that
 * pendingHandoffs leaves out of the prompt. They are superseded by the newer
 * summaries, so a turn that hands over the newest marks all of them done;
 * otherwise they would come back later as "since your last reply".
 */
async function pendingHandoffIds(sessionId: string): Promise<string[]> {
  const rows = await prisma.assistantMessage.findMany({ where: pendingHandoffWhere(sessionId), select: { id: true } });
  return rows.map((r) => r.id);
}

async function markHandoffsDone(ids: string[]): Promise<void> {
  for (const id of ids) {
    const row = await prisma.assistantMessage.findUnique({ where: { id }, select: { meta: true } }).catch(() => null);
    if (!row) continue;
    let meta: Record<string, unknown> = {};
    try { meta = JSON.parse(row.meta || "{}"); } catch { /* replaced below */ }
    await prisma.assistantMessage
      .update({ where: { id }, data: { meta: JSON.stringify({ ...meta, handoff: HANDOFF_DONE }) } })
      .catch((err) => console.error("[executeTurn] handoff bookkeeping failed", err));
  }
}

/**
 * Runs one CLI turn inside a run context: optional RAG augmentation, pending
 * orchestration summaries, live events into the hub, progressive transcript
 * persistence, and the session's resume id + cost bookkeeping.
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

  // Whether this turn continues the session's own conversation. A turn that
  // overrides externalId (a fresh-context loop iteration) runs in a throwaway
  // conversation that is never stored on the session.
  const keepContext = opts.rowOverrides?.externalId === undefined;

  // Orchestrations since the last turn ran in forks of this conversation.
  const handoffs = await pendingHandoffs(ctx.sessionId).catch(() => [] as Handoff[]);
  const handoffIds = handoffs.length ? await pendingHandoffIds(ctx.sessionId).catch(() => handoffs.map((h) => h.id)) : [];
  if (handoffs.length) {
    effectivePrompt = withHandoffs(effectivePrompt, handoffs);
    emit({ type: "notice", content: handoffs.length === 1 ? "Zusammenfassung der Orchestrierung an den Agenten übergeben." : `${handoffs.length} Orchestrierungs-Zusammenfassungen an den Agenten übergeben.` });
  }

  const row = toSessionRow(session, { interactive: !!opts.interactive, ...opts.rowOverrides });
  const result = await runTurn(row, effectivePrompt, opts.apiKey, emit, { signal: ctx.signal });
  ctx.writer.flushText();
  // A turn that failed may not have reached the agent: hand over again next
  // time. A throwaway conversation (like an orchestration fork) leaves them
  // pending too — the session's own conversation still has to be told. Runs
  // are exclusive per session, so no handoff can appear between read and mark.
  if (handoffIds.length && !result.isError && keepContext) await markHandoffsDone(handoffIds);

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
