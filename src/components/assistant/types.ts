// Client-side types for the Code Assistant UI. Server contracts are imported as
// types only (erased at build time), so no server module ends up in the bundle.
import type { ApprovalEvent, DiffPart, QuestionItem, QuestionOption } from "@/lib/assistant/approvals";
import type { RunEndStatus, RunKind, RunOrigin } from "@/lib/assistant/run-hub";
import type { PlannedSubtask } from "@/lib/assistant/orchestrator";
import type { ReviewVerdict } from "@/lib/assistant/orchestra-types";

export type { ApprovalEvent, DiffPart, QuestionItem, QuestionOption, RunEndStatus, RunKind, RunOrigin, PlannedSubtask, ReviewVerdict };

/** Row of GET /api/assistant/sessions. */
export interface SessionSummary {
  id: string;
  provider: string;
  model: string;
  title: string;
  cwd: string;
  /** DB status: "running" | "idle" | "error". */
  status: string;
  totalCostUsd: number;
  messageCount: number;
  updatedAt: string;
}

/** The session settings returned by GET /api/assistant/sessions/[id]. */
export interface SessionInfo {
  id: string;
  provider: string;
  model: string;
  title: string;
  cwd: string;
  status: string;
  permissionMode: string;
  /** CSV of tool names. */
  allowedTools: string;
  approvalMode: string;
  sandbox: boolean;
  totalCostUsd: number;
  createdAt?: string;
  updatedAt?: string;
}

/** One transcript row — persisted (has `id`) or live from the run stream. */
export interface Msg {
  id?: string;
  /** user | assistant | tool_use | tool_result | system | error | plan | synthesis | knowledge | thinking */
  role: string;
  content: string;
  /** JSON (same shape for persisted and live rows). */
  meta?: string;
  /** Persisted rows: ISO time the row was written. */
  createdAt?: string;
  /** Live rows: server time (epoch ms) of the event that created the row. */
  at?: number;
  /** Live only: the orchestrator subtask this row streams into. */
  subtaskId?: string;
  /** Optimistic user row that the server has not confirmed yet. */
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
  session?: Partial<SessionInfo> & { messages?: Msg[] };
  run?: RunSnapshot | null;
}

export type LoopEndReason = "promise" | "blocked" | "max" | "stopped" | "error";

type RunEventBody =
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
  | { type: "log"; content?: string; notice?: boolean }
  | { type: "plan"; subtasks?: PlannedSubtask[]; roles?: { id: string; name: string; editsFiles: boolean }[] }
  | {
      type: "subtask_start";
      subtaskId: string;
      title?: string;
      workerId?: string;
      workerLabel?: string;
      roleId?: string;
      roleName?: string;
    }
  | { type: "subtask_text"; subtaskId: string; content?: string; fixRound?: number }
  | { type: "subtask_end"; subtaskId: string; workerLabel?: string; roleId?: string; roleName?: string }
  | {
      type: "review_start";
      subtaskId: string;
      round?: number;
      maxRounds?: number;
      reviewerRoleId?: string;
      reviewerRoleName?: string;
      reviewerLabel?: string;
    }
  | { type: "review_text"; subtaskId: string; round?: number; content?: string }
  | { type: "review_end"; subtaskId: string; round?: number; verdict?: ReviewVerdict }
  | { type: "synthesis"; content?: string }
  | { type: "loop_iteration"; iteration: number; maxIterations: number; freshContext?: boolean }
  | { type: "loop_wait"; iteration: number; resumeAt: number }
  | { type: "loop_end"; reason: LoopEndReason; iterations: number };

/**
 * Events on GET /api/assistant/sessions/[id]/events (SSE `data:` payloads).
 * Every event carries `at`: the server time it was published (epoch ms).
 */
export type RunEvent = RunEventBody & { at?: number };

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
