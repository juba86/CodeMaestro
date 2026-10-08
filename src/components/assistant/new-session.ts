// Pure logic of the New-Session sheet (DESIGN.md §6.2.3): permission presets,
// capability rules per agent, the safety warning and the remembered settings.
// Capabilities mirror the server (src/lib/assistant/runner.ts
// supportsApprovalGate / supportsSandbox); the server enforces them anyway.
import { providerLabel } from "@/lib/labels";

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
const CHANGING_TOOLS = ["Edit", "Write", "Bash", "Bash(git *)", "Bash(gh *)"];

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
  const changes = draft.allowedTools.some((t) => CHANGING_TOOLS.includes(t));
  const gate = APPROVAL_CAPABLE.has(draft.provider) ? draft.approvalMode : "off";
  return changes && gate === "off";
}

/** Footer summary: „CodeMaestro · Claude Code · Bearbeiten mit Freigabe". */
export function draftSummary(folder: string, draft: SessionDraft): string {
  const preset = matchPreset(draft);
  return [folder, agentLabel(draft.provider), preset ? PRESET_LABEL[preset] : "Eigene Einstellungen"].filter(Boolean).join(" · ");
}

/** Label for a tool chip (German verb, git/gh spelled out). */
export function toolChipLabel(tool: string, label: (t: string) => string): string {
  if (tool === "Bash(git *)") return "Git";
  if (tool === "Bash(gh *)") return "GitHub CLI";
  return label(tool);
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
    out.allowedTools = o.allowedTools.filter((t): t is string => typeof t === "string" && (tools.length === 0 || tools.includes(t)));
  }
  if (o.approvalMode === "off" || o.approvalMode === "edits" || o.approvalMode === "all") out.approvalMode = o.approvalMode;
  if (typeof o.sandbox === "boolean") out.sandbox = o.sandbox;
  if (typeof o.cwd === "string" && o.cwd.length <= 1000) out.cwd = o.cwd;
  return out;
}
