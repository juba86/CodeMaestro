// Pure reducer that folds the run event stream (live or replayed) into what the
// thread shows: live transcript items, pending approval/question cards, run
// meta and loop progress. Pure and immutable, so replaying the same events
// always yields the same state (StrictMode double-invocation safe).
import type { ApprovalEvent, Msg, RunEvent, RunMeta } from "./types";

export interface LoopProgress {
  iteration: number;
  maxIterations: number;
  /** Set while the loop pauses between iterations (epoch ms). */
  resumeAt?: number;
}

export interface LiveState {
  items: Msg[];
  approvals: ApprovalEvent[];
  questions: ApprovalEvent[];
  run: RunMeta | null;
  loop: LoopProgress | null;
  /** Index of the current turn's merged "thinking" item, if any. */
  thinkingAt: number | null;
}

export const EMPTY_LIVE: LiveState = {
  items: [],
  approvals: [],
  questions: [],
  run: null,
  loop: null,
  thinkingAt: null,
};

export type LiveAction =
  | { type: "reset" }
  /** Fresh attach to a run: drop live items and seed its pending cards. */
  | { type: "seed"; run: RunMeta; pending: ApprovalEvent[] }
  /** Merge pending cards (re-attach to the same run). */
  | { type: "pending"; pending: ApprovalEvent[] }
  /** Remove a card locally (decided by this client). */
  | { type: "dismiss"; approvalId: string }
  | { type: "event"; event: RunEvent }
  /** Several stream events at once (one render per batch). */
  | { type: "events"; events: RunEvent[] };

const LOOP_END_LABEL: Record<string, string> = {
  promise: "✅ Abschluss-Signal erkannt",
  blocked: "⛔ Blockiert – braucht deine Eingabe",
  max: "Max. Iterationen erreicht",
  stopped: "Gestoppt",
  error: "Abbruch nach Fehler",
};

export function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

function addCard(list: ApprovalEvent[], card: ApprovalEvent): ApprovalEvent[] {
  return list.some((c) => c.approvalId === card.approvalId) ? list : [...list, card];
}

function withPending(state: LiveState, pending: ApprovalEvent[]): LiveState {
  let { approvals, questions } = state;
  for (const p of pending) {
    if (p.type === "question_request") questions = addCard(questions, p);
    else if (p.type === "approval_request") approvals = addCard(approvals, p);
  }
  return approvals === state.approvals && questions === state.questions ? state : { ...state, approvals, questions };
}

function dismiss(state: LiveState, approvalId: string): LiveState {
  const approvals = state.approvals.filter((a) => a.approvalId !== approvalId);
  const questions = state.questions.filter((q) => q.approvalId !== approvalId);
  return approvals.length === state.approvals.length && questions.length === state.questions.length
    ? state
    : { ...state, approvals, questions };
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

function applyEvent(state: LiveState, e: RunEvent): LiveState {
  switch (e.type) {
    case "run_start":
      return { ...state, run: { runId: e.runId, kind: e.kind, origin: e.origin, startedAt: e.startedAt }, thinkingAt: null };
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
      return push(state, { role: "assistant", content: e.content });
    }
    case "thinking": {
      if (!e.content) return state;
      const at = state.thinkingAt;
      const cur = at === null ? undefined : state.items[at];
      if (at !== null && cur?.role === "thinking") {
        return replaceAt(state, at, { ...cur, content: `${cur.content}\n\n${e.content}` });
      }
      return { ...push(state, { role: "thinking", content: e.content }), thinkingAt: state.items.length };
    }
    case "tool_use":
      return push(state, {
        role: "tool_use",
        content: e.name || "tool",
        meta: JSON.stringify({ name: e.name, input: e.input, toolUseId: e.toolUseId }),
      });
    case "tool_result":
      return push(state, {
        role: "tool_result",
        content: e.content || "",
        meta: JSON.stringify({ toolUseId: e.toolUseId, isError: e.isError }),
      });
    case "error":
      return e.content ? push(state, { role: "error", content: e.content }) : state;
    case "knowledge": {
      // Same rule as the transcript writer: nothing retrieved → no row.
      const sources = e.sources ?? [];
      if (sources.length === 0) return state;
      return push(state, {
        role: "knowledge",
        content: `${sources.length} Quelle(n) aus der Wissensbasis`,
        meta: JSON.stringify({ sources }),
      });
    }
    case "approval_request":
      return { ...state, approvals: addCard(state.approvals, e) };
    case "question_request":
      return { ...state, questions: addCard(state.questions, e) };
    case "approval_resolved":
    case "question_resolved":
      return dismiss(state, e.approvalId);
    case "plan":
      return push(state, { role: "plan", content: "", meta: JSON.stringify({ subtasks: e.subtasks ?? [] }) });
    case "subtask_start":
      return push(state, {
        role: "assistant",
        content: "",
        subtaskId: e.subtaskId,
        meta: JSON.stringify({ subtaskId: e.subtaskId, title: e.title, worker: e.workerLabel, workerId: e.workerId }),
      });
    case "subtask_text": {
      if (!e.content) return state;
      const idx = lastIndex(state.items, (m) => m.role === "assistant" && m.subtaskId === e.subtaskId);
      if (idx < 0) return state;
      const cur = state.items[idx];
      return replaceAt(state, idx, { ...cur, content: cur.content + e.content });
    }
    case "synthesis": {
      if (!e.content) return state;
      const idx = lastIndex(state.items, (m) => m.role === "synthesis");
      if (idx < 0) return push(state, { role: "synthesis", content: e.content });
      const cur = state.items[idx];
      return replaceAt(state, idx, { ...cur, content: cur.content + e.content });
    }
    case "loop_iteration":
      return {
        ...push(state, { role: "system", content: `🔁 Iteration ${e.iteration}/${e.maxIterations}` }),
        loop: { iteration: e.iteration, maxIterations: e.maxIterations },
        thinkingAt: null,
      };
    case "loop_wait":
      return {
        ...push(state, { role: "system", content: `⏸ Nächste Iteration um ${formatClock(e.resumeAt)}` }),
        loop: { iteration: e.iteration, maxIterations: state.loop?.maxIterations ?? 0, resumeAt: e.resumeAt },
      };
    case "loop_end": {
      const label = LOOP_END_LABEL[e.reason] ?? "Loop beendet";
      const n = e.iterations === 1 ? "1 Iteration" : `${e.iterations} Iterationen`;
      return { ...push(state, { role: "system", content: `${label} · ${n}` }), loop: null };
    }
    default:
      // run_end / idle are handled by the stream owner; log/result/subtask_end
      // carry nothing the thread renders.
      return state;
  }
}

export function liveReducer(state: LiveState, action: LiveAction): LiveState {
  switch (action.type) {
    case "reset":
      return EMPTY_LIVE;
    case "seed":
      return withPending({ ...EMPTY_LIVE, run: action.run }, action.pending);
    case "pending":
      return withPending(state, action.pending);
    case "dismiss":
      return dismiss(state, action.approvalId);
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
