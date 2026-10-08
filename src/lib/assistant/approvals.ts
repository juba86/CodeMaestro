import { promises as fs } from "fs";
import { randomBytes, timingSafeEqual } from "crypto";
import { diffLines } from "@/lib/diff";
import { getActiveRun, publish, type HubEvent } from "./run-hub";
import { notifySession } from "@/lib/push";

export interface QuestionOption { label: string; description?: string }
export interface QuestionItem {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: QuestionOption[];
}

export type DiffPart = { op: "equal" | "add" | "del"; text: string };

export interface ApprovalEvent {
  type: "approval_request" | "approval_resolved" | "question_request" | "question_resolved";
  approvalId: string;
  tool?: string;
  command?: string;
  filePath?: string;
  isWrite?: boolean;
  /** Write to a file that already exists (the diff is against its current content). */
  overwrites?: boolean;
  diff?: DiffPart[];
  decision?: "allow" | "deny";
  // Interactive questions (AskUserQuestion / ExitPlanMode), surfaced to the UI as
  // clickable options instead of a silent, unanswerable tool call.
  kind?: "ask" | "plan";
  questions?: QuestionItem[];
  plan?: string;
  /** Epoch ms after which the request auto-denies. */
  expiresAt?: number;
}

const QUESTION_TOOLS = new Set(["AskUserQuestion", "ExitPlanMode"]);
export function isQuestionTool(tool: string): boolean {
  return QUESTION_TOOLS.has(tool);
}

export type Decision = { decision: "allow" | "deny"; reason?: string };

interface PendingApproval {
  sessionId: string;
  event: ApprovalEvent;
  decided?: Decision;
  waiters: Set<(d: Decision) => void>;
  timer: ReturnType<typeof setTimeout>;
}

interface ApprovalState {
  pending: Map<string, PendingApproval>;
  counter: number;
  hookToken: string;
}

// globalThis: the hook callback route and the run that created the request may
// live in different Next.js module graphs (e.g. Telegram started from
// instrumentation), so the registry must be process-wide.
const g = globalThis as unknown as { __cmApprovals?: ApprovalState };
function state(): ApprovalState {
  if (!g.__cmApprovals) {
    g.__cmApprovals = { pending: new Map(), counter: 0, hookToken: randomBytes(24).toString("hex") };
  }
  return g.__cmApprovals;
}

/** Per-process secret the PreToolUse hook presents when calling back. */
export function hookToken(): string {
  return state().hookToken;
}

export function isValidHookToken(token: string | null | undefined): boolean {
  if (!token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(hookToken());
  return a.length === b.length && timingSafeEqual(a, b);
}

/** How long an approval/question waits for the user before auto-denying. */
export function approvalTimeoutMs(): number {
  const sec = Number(process.env.ASSISTANT_APPROVAL_TIMEOUT_SEC);
  return (Number.isFinite(sec) && sec >= 30 ? sec : 1800) * 1000;
}

function nextId(): string {
  const s = state();
  s.counter = (s.counter + 1) % 1_000_000;
  return `apr_${Date.now().toString(36)}_${s.counter}_${randomBytes(3).toString("hex")}`;
}

interface ToolInput {
  file_path?: string;
  old_string?: string;
  new_string?: string;
  replace_all?: boolean;
  content?: string;
  command?: string;
  edits?: unknown;
  notebook_path?: string;
  new_source?: string;
  // AskUserQuestion / ExitPlanMode
  questions?: unknown;
  plan?: unknown;
}

// LCS diffs are O(n·m); beyond this many cells fall back to a plain del/add
// listing so a huge edit can't stall the event loop while building the card.
const MAX_DIFF_CELLS = 2_000_000;

function safeDiff(before: string, after: string): DiffPart[] {
  const n = before ? before.split("\n").length : 0;
  const m = after ? after.split("\n").length : 0;
  if (n * m <= MAX_DIFF_CELLS) return diffLines(before, after);
  const del: DiffPart[] = before ? before.split("\n").map((text) => ({ op: "del", text })) : [];
  const add: DiffPart[] = after ? after.split("\n").map((text) => ({ op: "add", text })) : [];
  return [...del, ...add];
}

// Normalize an AskUserQuestion / ExitPlanMode tool input into a UI-renderable
// question event (clickable options or a plan to approve).
function buildQuestionEvent(approvalId: string, tool: string, input: ToolInput): ApprovalEvent {
  if (tool === "ExitPlanMode") {
    return {
      type: "question_request",
      approvalId,
      tool,
      kind: "plan",
      plan: typeof input.plan === "string" ? input.plan : "",
    };
  }
  // AskUserQuestion
  const rawQs = Array.isArray(input.questions) ? input.questions : [];
  const questions: QuestionItem[] = rawQs.slice(0, 10).map((q): QuestionItem => {
    const obj = (q && typeof q === "object" ? q : {}) as Record<string, unknown>;
    const rawOpts = Array.isArray(obj.options) ? obj.options : [];
    const options: QuestionOption[] = rawOpts.slice(0, 12).map((o) =>
      typeof o === "string"
        ? { label: o }
        : {
            label: String((o as Record<string, unknown>)?.label ?? ""),
            description: (o as Record<string, unknown>)?.description
              ? String((o as Record<string, unknown>).description)
              : undefined,
          }
    );
    return {
      question: String(obj.question ?? ""),
      header: obj.header ? String(obj.header) : undefined,
      multiSelect: !!obj.multiSelect,
      options,
    };
  });
  return { type: "question_request", approvalId, tool, kind: "ask", questions };
}

async function readExisting(filePath?: string): Promise<string | null> {
  if (!filePath) return null;
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > 2_000_000) return null;
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

// Claude Code's own tools whose input is fully described by one target (a
// path, URL, query, pattern or prompt).
const SINGLE_TARGET_TOOLS = new Set(["Read", "Grep", "Glob", "LS", "NotebookRead", "WebFetch", "WebSearch", "Task", "Agent"]);
const PATH_KEYS = ["file_path", "notebook_path", "path"] as const;

function clippedJson(value: Record<string, unknown>): string {
  let json = "";
  try { json = JSON.stringify(value) ?? ""; } catch { /* unserializable */ }
  return json && json !== "{}" ? json.slice(0, 2000) : "";
}

/**
 * What a generic tool call targets. Claude Code's read/search/web tools: the
 * file path or a one-line target. Any other tool (MCP servers, …): the path
 * plus every other input field as JSON — a path alone would hide e.g. which
 * repository, branch or content a GitHub MCP write goes to.
 */
function describeOther(tool: string, input: Record<string, unknown>): Pick<ApprovalEvent, "filePath" | "command"> {
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "");
  const pathKey = PATH_KEYS.find((k) => str(input[k]));
  const file = pathKey ? str(input[pathKey]) : "";
  if (SINGLE_TARGET_TOOLS.has(tool)) {
    if (file) return { filePath: file };
    const target = str(input.url) || str(input.query) || str(input.pattern) || str(input.command) || str(input.prompt);
    if (target) return { command: target.slice(0, 2000) };
    const json = clippedJson(input);
    return json ? { command: json } : {};
  }
  const rest = { ...input };
  if (pathKey) delete rest[pathKey];
  const json = clippedJson(rest);
  return { ...(file ? { filePath: file } : {}), ...(json ? { command: json } : {}) };
}

async function buildEvent(approvalId: string, tool: string, input: ToolInput): Promise<ApprovalEvent> {
  if (tool === "Bash") {
    return { type: "approval_request", approvalId, tool, command: input.command || "" };
  }
  if (tool === "Write") {
    // Diff against the current file so overwriting is visible as such.
    const existing = await readExisting(input.file_path);
    const diff = safeDiff(existing ?? "", input.content || "");
    return {
      type: "approval_request", approvalId, tool, filePath: input.file_path,
      isWrite: true, overwrites: existing !== null, diff,
    };
  }
  if (tool === "MultiEdit" && Array.isArray(input.edits)) {
    // A MultiEdit carries an edits[] array — show every hunk, separated.
    const diff: DiffPart[] = [];
    input.edits.slice(0, 50).forEach((raw, i) => {
      const e = (raw && typeof raw === "object" ? raw : {}) as ToolInput;
      if (i > 0) diff.push({ op: "equal", text: "⋯" });
      diff.push(...safeDiff(String(e.old_string ?? ""), String(e.new_string ?? "")));
    });
    return { type: "approval_request", approvalId, tool, filePath: input.file_path, diff };
  }
  if (tool === "NotebookEdit") {
    const diff = safeDiff("", input.new_source || "");
    return { type: "approval_request", approvalId, tool, filePath: input.notebook_path, diff };
  }
  if (tool !== "Edit") {
    // Any other tool that needs permission (WebFetch, a read outside the
    // project, an MCP tool, …): name its target instead of an empty diff.
    return { type: "approval_request", approvalId, tool, ...describeOther(tool, input as Record<string, unknown>) };
  }
  // Edit
  const diff = safeDiff(input.old_string || "", input.new_string || "");
  return { type: "approval_request", approvalId, tool, filePath: input.file_path, diff };
}

/**
 * Creates an approval (or interactive question) for a tool call and publishes
 * it into the session's live run, where every attached client — and clients
 * that attach later — can see it. Returns the id to wait on, or an immediate
 * deny when no run is active (nothing should execute unattended).
 */
export async function createApproval(
  sessionId: string,
  tool: string,
  input: ToolInput
): Promise<{ approvalId: string } | Decision> {
  if (!getActiveRun(sessionId)) {
    return { decision: "deny", reason: "Keine aktive Ausführung für die Freigabe." };
  }
  const approvalId = nextId();
  const question = isQuestionTool(tool);
  const event = question ? buildQuestionEvent(approvalId, tool, input) : await buildEvent(approvalId, tool, input);
  const timeout = approvalTimeoutMs();
  event.expiresAt = Date.now() + timeout;

  const timer = setTimeout(() => {
    decide(approvalId, {
      decision: "deny",
      reason: question ? "Keine Antwort (Timeout)." : "Freigabe-Timeout.",
    });
  }, timeout);
  (timer as { unref?: () => void }).unref?.();

  state().pending.set(approvalId, { sessionId, event, waiters: new Set(), timer });
  publish(sessionId, event as unknown as HubEvent);
  void notifySession(sessionId, question ? "question" : "approval", { detail: event.command || event.filePath || event.questions?.[0]?.question || tool });
  return { approvalId };
}

function decide(approvalId: string, d: Decision): boolean {
  const s = state();
  const p = s.pending.get(approvalId);
  if (!p || p.decided) return false;
  clearTimeout(p.timer);
  p.decided = d;
  const question = p.event.type === "question_request";
  publish(p.sessionId, {
    type: question ? "question_resolved" : "approval_resolved",
    approvalId,
    decision: d.decision,
  });
  for (const w of p.waiters) w(d);
  p.waiters.clear();
  // Keep the decision briefly so a polling hook that is between polls gets it.
  const t = setTimeout(() => s.pending.delete(approvalId), 120_000);
  (t as { unref?: () => void }).unref?.();
  return true;
}

/** Resolves a pending approval from a client (PWA button, Telegram callback). */
export function resolveApproval(approvalId: string, decision: "allow" | "deny", reason?: string): boolean {
  return decide(approvalId, { decision, reason: reason?.slice(0, 4000) });
}

/**
 * Waits up to `timeoutMs` for a decision. Resolves to the decision, "pending"
 * if still undecided, or "unknown" for an id that never existed / expired.
 */
export function waitForDecision(approvalId: string, timeoutMs: number): Promise<Decision | "pending" | "unknown"> {
  const p = state().pending.get(approvalId);
  if (!p) return Promise.resolve("unknown");
  if (p.decided) return Promise.resolve(p.decided);
  return new Promise((resolve) => {
    const onDecide = (d: Decision) => { clearTimeout(t); resolve(d); };
    const t = setTimeout(() => { p.waiters.delete(onDecide); resolve("pending"); }, timeoutMs);
    p.waiters.add(onDecide);
  });
}

/** Undecided approval/question events of a session (for re-rendering cards). */
export function listPending(sessionId: string): ApprovalEvent[] {
  const out: ApprovalEvent[] = [];
  for (const p of state().pending.values()) {
    if (p.sessionId === sessionId && !p.decided) out.push(p.event);
  }
  return out;
}

/** Denies every open request of a session (used when a run is stopped). */
export function denyAllPending(sessionId: string, reason = "Ausführung gestoppt."): number {
  let n = 0;
  for (const [id, p] of state().pending) {
    if (p.sessionId === sessionId && !p.decided && decide(id, { decision: "deny", reason })) n++;
  }
  return n;
}
