// German display labels for enums that reach the UI (DESIGN.md §8.3). Raw
// enum values never appear in copy: unknown values fall back to the raw id with
// its first letter capitalised, never to an empty string.

/** Claude Code permission modes (src/lib/assistant/security.ts PERMISSION_MODES). */
export const PERMISSION_MODE_LABEL: Record<string, string> = {
  default: "Nachfragen",
  acceptEdits: "Änderungen automatisch annehmen",
  plan: "Nur planen",
  auto: "Automatisch",
  dontAsk: "Nicht nachfragen",
  bypassPermissions: "Ohne Rückfrage (gefährlich)",
};

/** Approval gate modes (assistant sessions and the Telegram bridge). */
export const APPROVAL_MODE_LABEL: Record<string, string> = {
  off: "Aus – direkt ausführen",
  edits: "Nur Dateiänderungen",
  all: "Dateiänderungen & Befehle",
};

/** Coding agents an assistant session can run. "pi" mirrors PI_PROVIDER_LABEL. */
export const PROVIDER_LABEL: Record<string, string> = {
  claude: "Claude Code",
  gemini: "Gemini CLI",
  opencode: "OpenCode",
  codex: "Codex CLI",
  aider: "Aider",
  pi: "pi · lokale Modelle",
};

/** Agent tools, phrased as the action the agent takes. */
export const TOOL_LABEL: Record<string, string> = {
  Read: "Lesen",
  Grep: "Suchen",
  Glob: "Dateien finden",
  LS: "Ordner ansehen",
  Bash: "Befehl",
  "Bash(git *)": "Git-Befehle",
  "Bash(gh *)": "GitHub CLI",
  Edit: "Bearbeiten",
  MultiEdit: "Bearbeiten",
  Write: "Schreiben",
  NotebookEdit: "Notebook bearbeiten",
  WebSearch: "Websuche",
  WebFetch: "Web abrufen",
  TodoWrite: "Aufgaben",
  Task: "Unteragent",
  AskUserQuestion: "Frage",
  ExitPlanMode: "Plan",
};

// pi reports its built-in tools in lower case (see PI_DISPLAY_NAMES in
// src/lib/assistant/pi.ts); map them onto the Claude-style names above.
const PI_TOOL_ALIAS: Record<string, string> = {
  read: "Read",
  grep: "Grep",
  find: "Glob",
  ls: "LS",
  bash: "Bash",
  edit: "Edit",
  write: "Write",
};

export const RUN_KIND_LABEL: Record<string, string> = {
  turn: "Direkt",
  orchestrate: "Orchester",
  loop: "Loop",
};

export const RUN_ORIGIN_LABEL: Record<string, string> = {
  pwa: "in der App",
  telegram: "via Telegram",
};

/** Navigation labels keyed by route (plus the two mobile-only tabs). */
export const NAV_LABEL: Record<string, string> = {
  "/": "Start",
  "/assistant": "Assistent",
  "/orchestra": "Orchester",
  "/builder": "Builder",
  "/library": "Bibliothek",
  "/templates": "Vorlagen",
  "/playground": "Playground",
  "/knowledge": "Wissensbasis",
  "/settings": "Einstellungen",
  prompts: "Prompts",
  more: "Mehr",
};

/** The raw value, readable: first letter upper-cased; "Unbekannt" when empty. */
export function humanize(id: string | null | undefined): string {
  const s = (id ?? "").trim();
  if (!s) return "Unbekannt";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const has = (map: Record<string, string>, key: string) => Object.prototype.hasOwnProperty.call(map, key);

function lookup(map: Record<string, string>, id: string | null | undefined): string {
  const key = (id ?? "").trim();
  return has(map, key) ? map[key] : humanize(key);
}

export function providerLabel(id: string | null | undefined): string {
  return lookup(PROVIDER_LABEL, id);
}

export function toolLabel(name: string | null | undefined): string {
  const key = (name ?? "").trim();
  if (has(TOOL_LABEL, key)) return TOOL_LABEL[key];
  if (has(PI_TOOL_ALIAS, key)) return TOOL_LABEL[PI_TOOL_ALIAS[key]];
  return humanize(key);
}

export function permissionModeLabel(mode: string | null | undefined): string {
  return lookup(PERMISSION_MODE_LABEL, mode);
}

export function approvalModeLabel(mode: string | null | undefined): string {
  return lookup(APPROVAL_MODE_LABEL, mode);
}

export function runKindLabel(kind: string | null | undefined): string {
  return lookup(RUN_KIND_LABEL, kind);
}

export function runOriginLabel(origin: string | null | undefined): string {
  return lookup(RUN_ORIGIN_LABEL, origin);
}
