// Client-side types for the Code Assistant UI. Server contracts are imported as
// types only (erased at build time), so no server module ends up in the bundle.
import type { ApprovalEvent, DiffPart, QuestionItem, QuestionOption } from "@/lib/assistant/approvals";
import type { RunEndStatus, RunKind, RunOrigin } from "@/lib/assistant/run-hub";
import type { PlannedSubtask } from "@/lib/assistant/orchestrator";

export type { ApprovalEvent, DiffPart, QuestionItem, QuestionOption, RunEndStatus, RunKind, RunOrigin, PlannedSubtask };

export interface SessionSummary {
  id: string;
  provider: string;
  model: string;
  title: string;
  cwd: string;
  status: string;
  totalCostUsd: number;
  messageCount: number;
  updatedAt: string;
}

/** One transcript row — persisted (has `id`) or live from the run stream. */
export interface Msg {
  id?: string;
  /** user | assistant | tool_use | tool_result | system | error | plan | synthesis | knowledge | thinking */
  role: string;
  content: string;
  meta?: string;
  /** Live only: the orchestrator subtask this bubble streams into. */
  subtaskId?: string;
  /** Optimistic user bubble that the server has not confirmed yet. */
  local?: boolean;
}

export interface BrowseState {
  path: string;
  parent: string | null;
  dirs: { name: string; path: string }[];
}

export interface DevStatus {
  running: boolean;
  port?: number;
  /** HTTPS tailnet URL when the dev port is proxied via `tailscale serve` (else null). */
  url?: string | null;
  command?: string;
  logs?: string[];
  exitInfo?: string;
  suggestion?: { command: string; port: number; framework?: string };
}

export interface RunMeta {
  runId: string;
  kind: RunKind;
  origin: RunOrigin;
  startedAt: number;
}

/** `run` from GET /api/assistant/sessions/[id]. */
export interface RunSnapshot extends RunMeta {
  lastSeq: number;
  complete: boolean;
  attachFrom: number;
  pending: ApprovalEvent[];
}

export interface SessionPayload {
  session?: { messages?: Msg[] };
  run?: RunSnapshot | null;
}

/** Events on GET /api/assistant/sessions/[id]/events (SSE `data:` payloads). */
export type RunEvent =
  | { type: "run_start"; runId: string; kind: RunKind; origin: RunOrigin; startedAt: number }
  | { type: "run_end"; runId: string; status: RunEndStatus; error?: string }
  | { type: "idle" }
  | { type: "init"; sessionId?: string; model?: string }
  | { type: "text"; content?: string }
  | { type: "thinking"; content?: string }
  | { type: "tool_use"; name?: string; input?: unknown; toolUseId?: string }
  | { type: "tool_result"; toolUseId?: string; content?: string; isError?: boolean }
  | { type: "result"; content?: string; costUsd?: number; isError?: boolean }
  | { type: "error"; content?: string; subtaskId?: string }
  | { type: "knowledge"; sources?: string[] }
  | ApprovalEvent
  | { type: "log"; content?: string }
  | { type: "plan"; subtasks?: PlannedSubtask[] }
  | { type: "subtask_start"; subtaskId: string; title?: string; workerId?: string; workerLabel?: string }
  | { type: "subtask_text"; subtaskId: string; content?: string }
  | { type: "subtask_end"; subtaskId: string; workerLabel?: string }
  | { type: "synthesis"; content?: string }
  | { type: "loop_iteration"; iteration: number; maxIterations: number; freshContext?: boolean }
  | { type: "loop_wait"; iteration: number; resumeAt: number }
  | { type: "loop_end"; reason: "promise" | "max" | "stopped" | "error"; iterations: number };

/** Loop-mode options (body of POST /loop next to prompt/apiKey/useKnowledge). */
export interface LoopOptions {
  maxIterations: number;
  completionPromise: string;
  intervalSec: number;
  freshContext: boolean;
  stopOnError: boolean;
}

export const DEFAULT_LOOP_OPTIONS: LoopOptions = {
  maxIterations: 10,
  completionPromise: "DONE",
  intervalSec: 0,
  freshContext: false,
  stopOnError: true,
};

export type Decide = (card: ApprovalEvent, decision: "allow" | "deny", reason?: string) => void;
