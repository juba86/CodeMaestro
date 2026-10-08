// Pure logic of the New-Session sheet (DESIGN.md §6.2.3): permission presets,
// capability rules per agent, the safety warning and the remembered settings.
// Capabilities mirror the server (src/lib/assistant/runner.ts
// supportsApprovalGate / supportsSandbox); the server rejects a session that
// asks for a gate or sandbox its agent cannot honour (400), so the sheet must
// never send one (capabilityFields).
import { TOOL_GROUP_LABEL, approvalModeLabel, providerLabel } from "@/lib/labels";
import { toolGroupOf } from "@/lib/assistant/tool-rules";

export const AGENTS = ["claude", "gemini", "opencode", "codex", "aider", "pi"] as const;
export type AgentId = (typeof AGENTS)[number];

/** Approval gate: Claude Code (PreToolUse hook) and pi (tool_call extension). */
export const APPROVAL_CAPABLE: ReadonlySet<string> = new Set(["claude", "pi"]);
/** The sandbox is Claude Code's own settings feature. */
export const SANDBOX_CAPABLE: ReadonlySet<string> = new Set(["claude"]);

export type ApprovalMode = "off" | "edits" | "all";
export type PermissionPreset = "read" | "gated" | "autonomous";

export interface SessionDraft {
  provider: string;
  model: string;
  permissionMode: string;
  allowedTools: string[];
  approvalMode: ApprovalMode;
  sandbox: boolean;
}

export const READ_TOOLS = ["Read", "Grep", "Glob"];
export const EDIT_TOOLS = ["Read", "Grep", "Glob", "Edit", "Write", "Bash"];

/** Tools that change things: edits and any shell command (git/gh rules included). */
const isChangingTool = (t: string) => t === "Edit" || t === "Write" || t === "Bash" || t.startsWith("Bash(");

export const PRESET_LABEL: Record<PermissionPreset, string> = {
  read: "Nur lesen",
  gated: "Bearbeiten mit Freigabe",
  autonomous: "Volle Autonomie",
};

export const PRESET_DESCRIPTION: Record<PermissionPreset, string> = {
  read: "Liest und sucht, ändert nichts.",
  gated: "Jede Änderung und jeder Befehl wartet auf deine Freigabe.",
  autonomous: "Dieselben Werkzeuge, aber ohne Freigabe.",
};

/** German agent name („Claude Code", „pi · lokale Modelle"). */
export function agentLabel(provider: string): string {
  return providerLabel(provider);
}

/** One-line capability note under the agent choice. */
export function capabilityNote(provider: string): string {
  if (SANDBOX_CAPABLE.has(provider)) return "Dateien ändern ✓ · Freigabe & Sandbox ✓";
  if (APPROVAL_CAPABLE.has(provider)) return "Dateien ändern ✓ · Freigabe ✓ · ohne Sandbox";
  return "Dateien ändern ✓ · ohne Freigabe-Gate";
}

/** Why a preset cannot be used with this agent (null = available). */
export function presetDisabledReason(preset: PermissionPreset, provider: string): string | null {
  if (preset === "gated" && !APPROVAL_CAPABLE.has(provider)) return "Freigabe-Gate nur mit Claude Code oder pi.";
  return null;
}

/** The settings a preset stands for, for this agent. */
export function applyPreset(draft: SessionDraft, preset: PermissionPreset): SessionDraft {
  const sandbox = SANDBOX_CAPABLE.has(draft.provider);
  switch (preset) {
    case "read":
      return { ...draft, allowedTools: [...READ_TOOLS], approvalMode: "off", sandbox: false, permissionMode: "default" };
    case "gated":
      return { ...draft, allowedTools: [...EDIT_TOOLS], approvalMode: APPROVAL_CAPABLE.has(draft.provider) ? "all" : "off", sandbox, permissionMode: "default" };
    case "autonomous":
      return { ...draft, allowedTools: [...EDIT_TOOLS], approvalMode: "off", sandbox, permissionMode: "default" };
  }
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** The preset the draft matches exactly, or null („Eigene Einstellungen"). */
export function matchPreset(draft: SessionDraft): PermissionPreset | null {
  if (draft.permissionMode !== "default") return null;
  for (const p of ["read", "gated", "autonomous"] as const) {
    if (presetDisabledReason(p, draft.provider)) continue;
    const want = applyPreset(draft, p);
    if (sameSet(draft.allowedTools, want.allowedTools) && draft.approvalMode === want.approvalMode && draft.sandbox === want.sandbox) {
      return p;
    }
  }
  return null;
}

/** The default preset for an agent: gated where supported, else read-only. */
export function defaultPreset(provider: string): PermissionPreset {
  return APPROVAL_CAPABLE.has(provider) ? "gated" : "read";
}

/** Changes the agent: capability-bound settings follow, model ids don't carry over between pi and the CLIs. */
export function switchAgent(draft: SessionDraft, provider: string): SessionDraft {
  const keepModel = (provider === "pi") === (draft.provider === "pi");
  const before = matchPreset(draft);
  let next: SessionDraft = { ...draft, provider, model: keepModel ? draft.model : "" };
  const preset = before && !presetDisabledReason(before, provider) ? before : defaultPreset(provider);
  next = before ? applyPreset(next, preset) : next;
  if (!APPROVAL_CAPABLE.has(provider)) next = { ...next, approvalMode: "off" };
  if (!SANDBOX_CAPABLE.has(provider)) next = { ...next, sandbox: false };
  return next;
}

/**
 * Inline safety warning when tools that change things run without a gate
 * (null = nothing to warn about).
 */
export function ungatedWarning(draft: SessionDraft): string | null {
  const edits = draft.allowedTools.some((t) => t === "Edit" || t === "Write");
  const commands = draft.allowedTools.some((t) => t === "Bash" || t.startsWith("Bash("));
  const gate = APPROVAL_CAPABLE.has(draft.provider) ? draft.approvalMode : "off";
  if (gate === "all") return null;
  if (gate === "edits") return commands ? "Befehle laufen ohne Rückfrage – nur Dateiänderungen warten auf deine Freigabe." : null;
  if (edits && commands) return "Ohne Freigabe ändert der Agent Dateien und führt Befehle direkt aus.";
  if (edits) return "Ohne Freigabe ändert der Agent Dateien direkt.";
  if (commands) return "Ohne Freigabe führt der Agent Befehle direkt aus.";
  return null;
}

/** True when the draft lets the agent change things without any gate (needs the confirmation). */
export function needsAutonomyConsent(draft: SessionDraft): boolean {
  const changes = draft.allowedTools.some(isChangingTool);
  const gate = APPROVAL_CAPABLE.has(draft.provider) ? draft.approvalMode : "off";
  return changes && gate === "off";
}

/** Footer summary: „CodeMaestro · Claude Code · Bearbeiten mit Freigabe". */
export function draftSummary(folder: string, draft: SessionDraft): string {
  const preset = matchPreset(draft);
  return [folder, agentLabel(draft.provider), preset ? PRESET_LABEL[preset] : "Eigene Einstellungen"].filter(Boolean).join(" · ");
}

/** Label for a tool chip (German verb; git/gh rules by their group: „Git", „GitHub CLI"). */
export function toolChipLabel(tool: string, label: (t: string) => string): string {
  const group = toolGroupOf(tool);
  return group ? TOOL_GROUP_LABEL[group.id] : label(tool);
}

/** One chip of the tool allowlist: a single tool, or a whole git/gh rule group. */
export interface ToolChip {
  key: string;
  label: string;
  rules: string[];
}

/**
 * Chips for the offered tools: each git/gh rule group collapses into ONE chip
 * (placed where its first rule is) that toggles all of the group's rules.
 */
export function toolChips(tools: readonly string[], label: (t: string) => string): ToolChip[] {
  const out: ToolChip[] = [];
  const seen = new Set<string>();
  for (const t of tools) {
    const group = toolGroupOf(t);
    if (!group) {
      out.push({ key: t, label: label(t), rules: [t] });
    } else if (!seen.has(group.id)) {
      seen.add(group.id);
      out.push({ key: group.id, label: TOOL_GROUP_LABEL[group.id], rules: tools.filter((x) => toolGroupOf(x)?.id === group.id) });
    }
  }
  return out;
}

/** A chip is on when the draft allows all of its rules. */
export function chipPressed(chip: ToolChip, allowedTools: readonly string[]): boolean {
  return chip.rules.every((r) => allowedTools.includes(r));
}

/** Turns a chip's rules on or off (a legacy broad git/gh rule is replaced/removed too). */
export function toggleChip(allowedTools: readonly string[], chip: ToolChip, on: boolean): string[] {
  const legacy = chip.rules.map((r) => toolGroupOf(r)?.legacy).filter((r): r is string => !!r);
  const drop = new Set([...chip.rules, ...legacy]);
  const rest = allowedTools.filter((t) => !drop.has(t));
  return on ? [...rest, ...chip.rules] : rest;
}

/**
 * Honest note under the tool chips while Git / GitHub CLI are allowed without
 * confirming every command (null otherwise; pi ignores these rules anyway).
 */
export function commandRulesHint(draft: SessionDraft): string | null {
  if (draft.provider === "pi" || !draft.allowedTools.some((t) => toolGroupOf(t))) return null;
  const base = "Git und GitHub CLI erlauben nur gängige Unterbefehle – Repository-Hooks und Git-Einstellungen können trotzdem beliebigen Code ausführen.";
  if (!APPROVAL_CAPABLE.has(draft.provider)) return base;
  if (draft.approvalMode === "all") return null;
  return `${base} Mit Freigabe „${approvalModeLabel("all")}“ bestätigst du jeden Befehl.`;
}

/** The gate and sandbox fields to send: never one the agent cannot honour (the server rejects those). */
export function capabilityFields(draft: SessionDraft): Pick<SessionDraft, "approvalMode" | "sandbox"> {
  return {
    approvalMode: APPROVAL_CAPABLE.has(draft.provider) ? draft.approvalMode : "off",
    sandbox: SANDBOX_CAPABLE.has(draft.provider) && draft.sandbox,
  };
}

export const NEW_SESSION_STORAGE_KEY = "cm-new-session";

export interface StoredNewSession extends SessionDraft {
  cwd?: string;
}

/** Parses the remembered settings defensively (unknown fields and values are dropped). */
export function parseStoredDraft(raw: string | null, tools: string[], permissionModes: string[]): Partial<StoredNewSession> {
  if (!raw) return {};
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!v || typeof v !== "object") return {};
  const o = v as Record<string, unknown>;
  const out: Partial<StoredNewSession> = {};
  if (typeof o.provider === "string" && (AGENTS as readonly string[]).includes(o.provider)) out.provider = o.provider;
  if (typeof o.model === "string") out.model = o.model.slice(0, 200);
  if (typeof o.permissionMode === "string" && (permissionModes.length === 0 || permissionModes.includes(o.permissionMode))) {
    out.permissionMode = o.permissionMode;
  }
  if (Array.isArray(o.allowedTools)) {
    // A remembered broad "Bash(git *)" / "Bash(gh *)" becomes its narrow group.
    const listed = o.allowedTools
      .filter((t): t is string => typeof t === "string")
      .flatMap((t) => {
        const group = toolGroupOf(t);
        return group && group.legacy === t ? [...group.rules] : [t];
      });
    out.allowedTools = [...new Set(listed)].filter((t) => tools.length === 0 || tools.includes(t));
  }
  if (o.approvalMode === "off" || o.approvalMode === "edits" || o.approvalMode === "all") out.approvalMode = o.approvalMode;
  if (typeof o.sandbox === "boolean") out.sandbox = o.sandbox;
  if (typeof o.cwd === "string" && o.cwd.length <= 1000) out.cwd = o.cwd;
  return out;
}

// --- „Projekt fortsetzen": continue a Claude Code conversation of the folder ---
// The sheet lists the folder's Claude Code conversations (GET
// /api/assistant/claude-sessions) and preselects the most recent one; the new
// session then starts with `claude --resume <id>` (POST resumeSessionId). A
// conversation that already backs a CodeMaestro session is opened instead —
// the server answers 409 ALREADY_LINKED for a second link.

/** A Claude Code conversation of the chosen folder. */
export interface ClaudeConversation {
  id: string;
  title: string;
  /** ISO time of the last change. */
  updatedAt: string;
  messageCount?: number;
  /** The CodeMaestro session that already continues it. */
  linkedSessionId?: string;
}

/** Radio value of „Neue Unterhaltung starten". */
export const NEW_CONVERSATION = "new";

/** Conversations shown before „Ältere anzeigen". */
export const CONVERSATIONS_COLLAPSED = 3;

/** Only Claude Code resumes its conversations, and only once a folder is chosen. */
export function offersResume(provider: string, cwd: string): boolean {
  return provider === "claude" && cwd.trim() !== "";
}

export function conversationsUrl(cwd: string): string {
  return `/api/assistant/claude-sessions?cwd=${encodeURIComponent(cwd)}`;
}

const CONVERSATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The API answer, defensively (malformed entries dropped), newest first. */
export function parseConversations(data: unknown): ClaudeConversation[] {
  const raw = data && typeof data === "object" ? (data as { sessions?: unknown }).sessions : null;
  if (!Array.isArray(raw)) return [];
  const out: ClaudeConversation[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    if (typeof o.id !== "string" || !CONVERSATION_ID.test(o.id) || seen.has(o.id)) continue;
    if (typeof o.updatedAt !== "string" || !Number.isFinite(Date.parse(o.updatedAt))) continue;
    seen.add(o.id);
    out.push({
      id: o.id,
      title: typeof o.title === "string" ? o.title : "",
      updatedAt: o.updatedAt,
      ...(typeof o.messageCount === "number" ? { messageCount: o.messageCount } : {}),
      ...(typeof o.linkedSessionId === "string" && o.linkedSessionId ? { linkedSessionId: o.linkedSessionId } : {}),
    });
  }
  return out.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

/** The user's pick, remembered per folder. */
export interface ConversationPick {
  cwd: string;
  id: string;
}

/**
 * The selected radio value: the user's pick for this folder while it is still
 * listed, otherwise the most recent conversation (or a new one when there is none).
 */
export function conversationChoice(pick: ConversationPick | null, cwd: string, list: readonly ClaudeConversation[]): string {
  if (pick && pick.cwd === cwd && (pick.id === NEW_CONVERSATION || list.some((c) => c.id === pick.id))) return pick.id;
  return list[0]?.id ?? NEW_CONVERSATION;
}

export type ConversationAction =
  | { kind: "new" }
  | { kind: "resume"; conversation: ClaudeConversation }
  | { kind: "open"; sessionId: string; conversation: ClaudeConversation };

/** What „starten" does for this choice: a fresh conversation, a resumed one, or opening the session that has it. */
export function conversationAction(provider: string, choice: string, list: readonly ClaudeConversation[]): ConversationAction {
  if (provider !== "claude") return { kind: "new" };
  const conversation = list.find((c) => c.id === choice);
  if (!conversation) return { kind: "new" };
  if (conversation.linkedSessionId) return { kind: "open", sessionId: conversation.linkedSessionId, conversation };
  return { kind: "resume", conversation };
}

/** The resume field of the create request (none unless a conversation is continued). */
export function resumeFields(action: ConversationAction): { resumeSessionId?: string } {
  return action.kind === "resume" ? { resumeSessionId: action.conversation.id } : {};
}

/** Label of the sheet's main button. */
export function startLabel(action: ConversationAction): string {
  if (action.kind === "resume") return "Unterhaltung fortsetzen";
  if (action.kind === "open") return "Session öffnen";
  return "Session starten";
}

/** Rows to render: the first few, or all; the selected one is never hidden. */
export function visibleConversations(
  list: readonly ClaudeConversation[],
  choice: string,
  expanded: boolean,
  collapsed = CONVERSATIONS_COLLAPSED
): ClaudeConversation[] {
  if (expanded || list.length <= collapsed) return [...list];
  const head = list.slice(0, collapsed);
  const picked = list.find((c) => c.id === choice);
  return picked && !head.includes(picked) ? [...head, picked] : head;
}

export function conversationTitle(c: Pick<ClaudeConversation, "title">): string {
  return c.title.trim() || "Ohne Titel";
}

/** The session a 409 ALREADY_LINKED answer points to (null for any other answer). */
export function alreadyLinkedSessionId(status: number, body: unknown): string | null {
  if (status !== 409 || !body || typeof body !== "object") return null;
  const o = body as { code?: unknown; sessionId?: unknown };
  return o.code === "ALREADY_LINKED" && typeof o.sessionId === "string" && o.sessionId ? o.sessionId : null;
}
