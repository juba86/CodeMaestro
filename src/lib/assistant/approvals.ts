import { diffLines } from "@/lib/diff";

export interface ApprovalEvent {
  type: "approval_request" | "approval_resolved";
  approvalId: string;
  tool?: string;
  command?: string;
  filePath?: string;
  isWrite?: boolean;
  diff?: { op: "equal" | "add" | "del"; text: string }[];
  decision?: "allow" | "deny";
}

type Emit = (e: ApprovalEvent) => void;
type Decision = { decision: "allow" | "deny"; reason?: string };

// Per-session SSE emitter, registered while a turn streams. Lets the hook's
// approval request reach the browser through the active stream.
const emitters = new Map<string, Emit>();
// Pending approvals awaiting a user decision, keyed by approvalId.
const pending = new Map<string, { resolve: (d: Decision) => void; timer: ReturnType<typeof setTimeout> }>();

let counter = 0;
function nextId(): string {
  counter = (counter + 1) % 1_000_000;
  return `apr_${Date.now().toString(36)}_${counter}`;
}

export function registerEmitter(sessionId: string, emit: Emit) {
  emitters.set(sessionId, emit);
}
export function unregisterEmitter(sessionId: string) {
  emitters.delete(sessionId);
}

interface ToolInput {
  file_path?: string;
  old_string?: string;
  new_string?: string;
  content?: string;
  command?: string;
}

function buildEvent(approvalId: string, tool: string, input: ToolInput): ApprovalEvent {
  if (tool === "Bash") {
    return { type: "approval_request", approvalId, tool, command: input.command || "" };
  }
  if (tool === "Write") {
    const diff = diffLines("", input.content || "");
    return { type: "approval_request", approvalId, tool, filePath: input.file_path, isWrite: true, diff };
  }
  // Edit / MultiEdit
  const diff = diffLines(input.old_string || "", input.new_string || "");
  return { type: "approval_request", approvalId, tool, filePath: input.file_path, diff };
}

/**
 * Called from the hook bridge: emits an approval request to the session's live
 * stream and resolves once the user decides (or auto-denies after a timeout).
 */
export function requestApproval(
  sessionId: string,
  tool: string,
  input: ToolInput,
  timeoutMs = 300_000
): Promise<Decision> {
  const approvalId = nextId();
  const emit = emitters.get(sessionId);
  if (!emit) {
    // No live UI listening — be safe and deny so nothing runs unattended.
    return Promise.resolve({ decision: "deny", reason: "Keine aktive UI für die Freigabe." });
  }
  return new Promise<Decision>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(approvalId);
      emit({ type: "approval_resolved", approvalId, decision: "deny" });
      resolve({ decision: "deny", reason: "Freigabe-Timeout." });
    }, timeoutMs);
    pending.set(approvalId, { resolve, timer });
    emit(buildEvent(approvalId, tool, input));
  });
}

export function resolveApproval(approvalId: string, decision: "allow" | "deny", reason?: string): boolean {
  const p = pending.get(approvalId);
  if (!p) return false;
  clearTimeout(p.timer);
  pending.delete(approvalId);
  p.resolve({ decision, reason });
  return true;
}
