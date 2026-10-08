// Pure reducer that folds the run event stream (live or replayed) into what the
// thread shows: live transcript rows, pending approval/question cards and their
// receipts, run meta, loop progress and the orchestra live state. Pure and
// immutable, so replaying the same events always yields the same state
// (StrictMode double-invocation safe).
import { EMPTY_ORCHESTRA_LIVE, reduceOrchestraLive, type OrchestraLiveState } from "@/components/orchestra/live";
import { formatClock } from "@/lib/format";
import { RUN_STATE_META, isActive, loopEndText, type RunState } from "@/lib/run-state";
import { metaOf, row, type RowMeta } from "./meta";
import type { ApprovalEvent, Msg, RunEndStatus, RunEvent, RunMeta } from "./types";

export interface LoopProgress {
  iteration: number;
  maxIterations: number;
  /** Set while the loop pauses between iterations (epoch ms). */
  resumeAt?: number;
  freshContext?: boolean;
}

/** An open approval or question, with where it arrived in the live rows. */
export type PendingCard = ApprovalEvent & {
  /** Index into `items` the card follows (undefined: seeded from a snapshot → end). */
  pos?: number;
  /** Server time the request was published. */
  receivedAt?: number;
};

/** A decided (or expired) gate, kept as a one-line receipt in the thread. */
export interface GateReceipt {
  approvalId: string;
  card: PendingCard;
  decision: "allow" | "deny";
  /**
   * self = this device; other = another window/Telegram; timeout = expired;
   * gone = this device's decision came too late (expired or decided elsewhere).
   */
  by: "self" | "other" | "timeout" | "gone";
  reason?: string;
  at?: number;
}

export interface RunEnd {
  status: RunEndStatus;
  at?: number;
  error?: string;
  /** Sum of the run's reported costs (0 = unknown or free). */
  costUsd: number;
}

export interface LiveState {
  items: Msg[];
  approvals: PendingCard[];
  questions: PendingCard[];
  receipts: GateReceipt[];
  run: RunMeta | null;
  loop: LoopProgress | null;
  /** Index of the current turn's merged "thinking" item, if any. */
  thinkingAt: number | null;
  /** Orchestrator live state (roles, subtasks, reviews), fed by every event. */
  orch: OrchestraLiveState;
  /** Costs reported by `result` events of this run. */
  costUsd: number;
  /** How the last run ended (kept across `settle`). */
  ended: RunEnd | null;
}

export const EMPTY_LIVE: LiveState = {
  items: [],
  approvals: [],
  questions: [],
  receipts: [],
  run: null,
  loop: null,
  thinkingAt: null,
  orch: EMPTY_ORCHESTRA_LIVE,
  costUsd: 0,
  ended: null,
};

export type LiveAction =
  | { type: "reset" }
  /** Fresh attach to a run: drop live items and seed its pending cards. */
  | { type: "seed"; run: RunMeta; pending: ApprovalEvent[] }
  /** Merge pending cards (re-attach to the same run). */
  | { type: "pending"; pending: ApprovalEvent[] }
  /** Remove a card locally without a receipt. */
  | { type: "dismiss"; approvalId: string }
  /** This device decided a card: it becomes a receipt right away. */
  | { type: "decided"; approvalId: string; decision: "allow" | "deny"; reason?: string; at?: number }
  /** The decision could not be sent: put the card back. */
  | { type: "restore"; card: ApprovalEvent }
  /** The server no longer knew the gate (410): expired or decided elsewhere. */
  | { type: "gone"; approvalId: string }
  /** The run ended and the transcript was reloaded: keep only how it ended and the orchestra view. */
  | { type: "settle" }
  /** A run this client followed ended without its run_end reaching us (status from the session). */
  | { type: "finished"; status: RunEndStatus }
  | { type: "event"; event: RunEvent }
  /** Several stream events at once (one render per batch). */
  | { type: "events"; events: RunEvent[] };

function addCard(list: PendingCard[], card: PendingCard): PendingCard[] {
  const i = list.findIndex((c) => c.approvalId === card.approvalId);
  if (i < 0) return [...list, card];
  // A seeded card (no position) learns its place when the replay reaches it.
  if (list[i].pos === undefined && card.pos !== undefined) {
    const next = list.slice();
    next[i] = { ...list[i], pos: card.pos, receivedAt: card.receivedAt ?? list[i].receivedAt };
    return next;
  }
  return list;
}

function withPending(state: LiveState, pending: ApprovalEvent[]): LiveState {
  let { approvals, questions } = state;
  const decided = new Set(state.receipts.map((r) => r.approvalId));
  for (const p of pending) {
    if (decided.has(p.approvalId)) continue;
    if (p.type === "question_request") questions = addCard(questions, p);
    else if (p.type === "approval_request") approvals = addCard(approvals, p);
  }
  return approvals === state.approvals && questions === state.questions ? state : { ...state, approvals, questions };
}

function findCard(state: LiveState, approvalId: string): PendingCard | undefined {
  return state.approvals.find((a) => a.approvalId === approvalId) ?? state.questions.find((q) => q.approvalId === approvalId);
}

function dismiss(state: LiveState, approvalId: string): LiveState {
  const approvals = state.approvals.filter((a) => a.approvalId !== approvalId);
  const questions = state.questions.filter((q) => q.approvalId !== approvalId);
  return approvals.length === state.approvals.length && questions.length === state.questions.length
    ? state
    : { ...state, approvals, questions };
}

function toReceipt(state: LiveState, receipt: GateReceipt): LiveState {
  const next = dismiss(state, receipt.approvalId);
  return { ...next, receipts: [...next.receipts.filter((r) => r.approvalId !== receipt.approvalId), receipt] };
}

function push(state: LiveState, item: Msg): LiveState {
  return { ...state, items: [...state.items, item] };
}

function replaceAt(state: LiveState, idx: number, item: Msg): LiveState {
  const items = state.items.slice();
  items[idx] = item;
  return { ...state, items };
}

function lastIndex(items: Msg[], pred: (m: Msg) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) if (pred(items[i])) return i;
  return -1;
}

/** Appends `content` to a row, keeping its (cached) meta. */
function appended(m: Msg, content: string, patch?: RowMeta): Msg {
  const meta = patch ? { ...metaOf(m), ...patch } : metaOf(m);
  return row({ ...m, content: m.content + content }, meta);
}

/** The subtask's own output row (not a review or a fix round). */
const isWorkRow = (m: Msg, subtaskId: string) => {
  if (m.role !== "assistant" || m.subtaskId !== subtaskId) return false;
  const meta = metaOf(m);
  return !meta.review && !meta.fixRound;
};

const isReviewRow = (m: Msg, subtaskId: string, round: number | undefined) => {
  if (m.role !== "assistant" || m.subtaskId !== subtaskId) return false;
  const meta = metaOf(m);
  return !!meta.review && (round === undefined || meta.round === round);
};

const isFixRow = (m: Msg, subtaskId: string, round: number) =>
  m.role === "assistant" && m.subtaskId === subtaskId && metaOf(m).fixRound === round;

function applyItems(state: LiveState, e: RunEvent): LiveState {
  const at = typeof e.at === "number" ? e.at : undefined;
  switch (e.type) {
    case "run_start":
      return {
        ...state,
        run: { runId: e.runId, kind: e.kind, origin: e.origin, startedAt: e.startedAt },
        thinkingAt: null,
        ended: null,
      };
    case "init":
      return state.thinkingAt === null ? state : { ...state, thinkingAt: null };
    case "text": {
      if (!e.content) return state;
      // Text continues the current segment until a tool call (or anything
      // else) interrupts it — mirrors how the transcript is persisted.
      const idx = state.items.length - 1;
      const last = state.items[idx];
      if (last && last.role === "assistant" && !last.subtaskId) {
        return replaceAt(state, idx, { ...last, content: last.content + e.content });
      }
      return push(state, { role: "assistant", content: e.content, at });
    }
    case "thinking": {
      if (!e.content) return state;
      const pos = state.thinkingAt;
      const cur = pos === null ? undefined : state.items[pos];
      if (pos !== null && cur?.role === "thinking") {
        return replaceAt(state, pos, { ...cur, content: `${cur.content}\n\n${e.content}` });
      }
      return { ...push(state, { role: "thinking", content: e.content, at }), thinkingAt: state.items.length };
    }
    case "tool_use":
      return push(state, row({ role: "tool_use", content: e.name || "tool", at }, { name: e.name, input: e.input, toolUseId: e.toolUseId }));
    case "tool_result":
      return push(state, row({ role: "tool_result", content: e.content || "", at }, { toolUseId: e.toolUseId, isError: e.isError }));
    case "result":
      return typeof e.costUsd === "number" && e.costUsd > 0 ? { ...state, costUsd: state.costUsd + e.costUsd } : state;
    case "error":
      if (!e.content) return state;
      return push(state, row({ role: "error", content: e.content, at, subtaskId: e.subtaskId }, e.subtaskId ? { subtaskId: e.subtaskId } : undefined));
    case "notice":
      // Persisted as a system row by the transcript writer.
      return e.content ? push(state, row({ role: "system", content: e.content, at }, { notice: true })) : state;
    case "log":
      // Orchestrator notes marked as notices are persisted as system rows too.
      return e.notice && e.content ? push(state, row({ role: "system", content: e.content, at }, { notice: true })) : state;
    case "knowledge": {
      // Same rule as the transcript writer: nothing retrieved → no row.
      const sources = e.sources ?? [];
      if (sources.length === 0) return state;
      return push(state, row({ role: "knowledge", content: `${sources.length} Quelle(n) aus der Wissensbasis`, at }, { sources }));
    }
    case "approval_request":
    case "question_request": {
      const card: PendingCard = { ...e, pos: state.items.length, receivedAt: at };
      if (state.receipts.some((r) => r.approvalId === e.approvalId)) return state;
      return e.type === "question_request"
        ? { ...state, questions: addCard(state.questions, card) }
        : { ...state, approvals: addCard(state.approvals, card) };
    }
    case "approval_resolved":
    case "question_resolved": {
      const card = findCard(state, e.approvalId);
      if (!card) return state; // decided here (receipt exists) or never seen
      const expired = !!card.expiresAt && at !== undefined && at >= card.expiresAt - 1000;
      return toReceipt(state, {
        approvalId: e.approvalId,
        card,
        decision: e.decision === "allow" ? "allow" : "deny",
        by: expired && e.decision !== "allow" ? "timeout" : "other",
        at,
      });
    }
    case "plan":
      return push(state, row({ role: "plan", content: "", at }, { subtasks: e.subtasks ?? [], ...(e.roles ? { roles: e.roles } : {}) }));
    case "subtask_start":
      return push(
        state,
        row(
          { role: "assistant", content: "", subtaskId: e.subtaskId, at },
          {
            subtaskId: e.subtaskId,
            title: e.title,
            worker: e.workerLabel,
            workerId: e.workerId,
            ...(e.roleId ? { roleId: e.roleId } : {}),
            ...(e.roleName ? { roleName: e.roleName } : {}),
          },
        ),
      );
    case "subtask_text": {
      if (!e.content) return state;
      if (typeof e.fixRound === "number" && e.fixRound > 0) {
        // The author's fix round after review round n: its own section.
        const round = e.fixRound;
        const idx = lastIndex(state.items, (m) => isFixRow(m, e.subtaskId, round));
        if (idx >= 0) return replaceAt(state, idx, appended(state.items[idx], e.content));
        const work = state.items[lastIndex(state.items, (m) => isWorkRow(m, e.subtaskId))];
        const base = work ? metaOf(work) : {};
        return push(
          state,
          row(
            { role: "assistant", content: e.content.replace(/^\n+/, ""), subtaskId: e.subtaskId, at },
            { subtaskId: e.subtaskId, title: base.title, worker: base.worker, workerId: base.workerId, roleId: base.roleId, roleName: base.roleName, fixRound: round },
          ),
        );
      }
      const idx = lastIndex(state.items, (m) => isWorkRow(m, e.subtaskId));
      if (idx < 0) return state;
      return replaceAt(state, idx, appended(state.items[idx], e.content));
    }
    case "review_start":
      return push(
        state,
        row(
          { role: "assistant", content: "", subtaskId: e.subtaskId, at },
          {
            subtaskId: e.subtaskId,
            review: true,
            round: e.round,
            maxRounds: e.maxRounds,
            roleId: e.reviewerRoleId,
            roleName: e.reviewerRoleName,
            worker: e.reviewerLabel,
          },
        ),
      );
    case "review_text": {
      if (!e.content) return state;
      const idx = lastIndex(state.items, (m) => isReviewRow(m, e.subtaskId, e.round));
      if (idx >= 0) return replaceAt(state, idx, appended(state.items[idx], e.content));
      return push(
        state,
        row({ role: "assistant", content: e.content, subtaskId: e.subtaskId, at }, { subtaskId: e.subtaskId, review: true, round: e.round }),
      );
    }
    case "review_end": {
      const idx = lastIndex(state.items, (m) => isReviewRow(m, e.subtaskId, e.round));
      if (idx < 0) return state;
      return replaceAt(state, idx, appended(state.items[idx], "", { verdict: e.verdict ?? "unknown" }));
    }
    case "synthesis": {
      if (!e.content) return state;
      const idx = lastIndex(state.items, (m) => m.role === "synthesis");
      if (idx < 0) return push(state, { role: "synthesis", content: e.content, at });
      const cur = state.items[idx];
      return replaceAt(state, idx, { ...cur, content: cur.content + e.content });
    }
    case "loop_iteration":
      return {
        ...push(
          state,
          row(
            { role: "system", content: `🔁 Iteration ${e.iteration}/${e.maxIterations}`, at },
            { iteration: e.iteration, maxIterations: e.maxIterations, freshContext: e.freshContext },
          ),
        ),
        loop: { iteration: e.iteration, maxIterations: e.maxIterations, freshContext: e.freshContext },
        thinkingAt: null,
      };
    case "loop_wait":
      return {
        ...push(state, row({ role: "system", content: `⏸ Nächste Iteration um ${formatClock(e.resumeAt)}`, at }, { resumeAt: e.resumeAt })),
        loop: {
          iteration: e.iteration,
          maxIterations: state.loop?.maxIterations ?? 0,
          freshContext: state.loop?.freshContext,
          resumeAt: e.resumeAt,
        },
      };
    case "loop_end": {
      const { text } = loopEndText(e.reason, e.iterations);
      return { ...push(state, row({ role: "system", content: text, at }, { loopEnd: e.reason, iterations: e.iterations })), loop: null };
    }
    case "run_end":
      return {
        ...state,
        ended: { status: e.status, at, error: e.error, costUsd: state.costUsd },
      };
    default:
      // idle is handled by the stream owner; log/subtask_end carry nothing the
      // thread renders (subtask_end only updates the orchestra view).
      return state;
  }
}

function applyEvent(state: LiveState, e: RunEvent): LiveState {
  const next = applyItems(state, e);
  const orch = reduceOrchestraLive(next.orch, e, typeof e.at === "number" ? e.at : undefined);
  return orch === next.orch ? next : { ...next, orch };
}

export function liveReducer(state: LiveState, action: LiveAction): LiveState {
  switch (action.type) {
    case "reset":
      return EMPTY_LIVE;
    case "seed": {
      const orch =
        action.run.kind === "orchestrate"
          ? reduceOrchestraLive(EMPTY_ORCHESTRA_LIVE, { type: "run_start", ...action.run }, action.run.startedAt)
          : EMPTY_ORCHESTRA_LIVE;
      return withPending({ ...EMPTY_LIVE, run: action.run, orch }, action.pending);
    }
    case "pending":
      return withPending(state, action.pending);
    case "dismiss":
      return dismiss(state, action.approvalId);
    case "decided": {
      const card = findCard(state, action.approvalId);
      if (!card) return state;
      return toReceipt(state, {
        approvalId: action.approvalId,
        card,
        decision: action.decision,
        by: "self",
        reason: action.reason,
        at: action.at,
      });
    }
    case "restore": {
      const receipts = state.receipts.filter((r) => r.approvalId !== action.card.approvalId);
      const prev = state.receipts.find((r) => r.approvalId === action.card.approvalId)?.card;
      const card: PendingCard = prev ?? action.card;
      const base = { ...state, receipts };
      return card.type === "question_request"
        ? { ...base, questions: addCard(base.questions, card) }
        : { ...base, approvals: addCard(base.approvals, card) };
    }
    case "gone": {
      const receipts = state.receipts.map((r) => (r.approvalId === action.approvalId ? { ...r, by: "gone" as const } : r));
      return { ...state, receipts };
    }
    case "finished": {
      const ended = state.ended ?? { status: action.status, costUsd: state.costUsd };
      return { ...EMPTY_LIVE, orch: state.orch, ended };
    }
    case "settle":
      return state.orch === EMPTY_ORCHESTRA_LIVE && !state.ended ? EMPTY_LIVE : { ...EMPTY_LIVE, orch: state.orch, ended: state.ended };
    case "event":
      return applyEvent(state, action.event);
    case "events":
      return action.events.reduce(applyEvent, state);
  }
}

/** Status line for the running indicator. */
export function runningLabel(live: LiveState, stopping: boolean): string {
  if (stopping) return "Wird gestoppt…";
  const kind = live.run?.kind;
  if (kind === "loop") {
    const l = live.loop;
    if (l?.resumeAt) return `Loop wartet · nächste Iteration um ${formatClock(l.resumeAt)}`;
    if (l) return `Loop läuft · Iteration ${l.iteration}/${l.maxIterations}`;
    return "Loop läuft…";
  }
  if (kind === "orchestrate") return "Orchestrierung läuft…";
  return "Assistent arbeitet…";
}

/**
 * What the polite live region says when the open session's state changes
 * (DESIGN.md §7), or null to stay quiet: gates are announced assertively by
 * the thread and run errors by their alert, and going back to work after a
 * decision or a loop pause is not news.
 */
export function stateAnnouncement(before: RunState, after: RunState): string | null {
  if (before === after) return null;
  switch (after) {
    case "running":
    case "background":
    case "telegram":
      return isActive(before) ? null : RUN_STATE_META[after].label;
    case "done":
      return isActive(before) ? "Antwort fertig" : null;
    case "loop_paused":
    case "stopping":
    case "stopped":
    case "unknown":
      return RUN_STATE_META[after].label;
    default:
      return null;
  }
}

/** All open gates in arrival order (questions and approvals interleaved). */
export function pendingCards(live: Pick<LiveState, "approvals" | "questions">): PendingCard[] {
  const all = [...live.approvals, ...live.questions];
  return all.sort((a, b) => (a.pos ?? Infinity) - (b.pos ?? Infinity) || (a.receivedAt ?? 0) - (b.receivedAt ?? 0));
}
