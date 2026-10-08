// Pure model of the agent's tool calls for the thread (DESIGN.md §6.2.4):
// consecutive tool_use / tool_result rows fold into one ToolGroup with a German
// summary („4 Aktionen · Lesen ×2 · Suchen · Befehl"), and the inspector's
// „Dateien" list is derived from Edit/Write calls.
import { toolLabel } from "@/lib/labels";
import { metaOf, rowTime } from "./meta";
import type { Msg } from "./types";

export type ToolCallStatus = "running" | "ok" | "error" | "none";

export interface ToolCall {
  /** Stable key (row id or live index). */
  key: string;
  toolUseId?: string;
  /** Raw tool name (Read, Bash, edit, …). */
  name: string;
  /** German verb („Lesen", „Befehl"). */
  label: string;
  /** Path, pattern, command or URL the call works on („" when unknown). */
  target: string;
  input: unknown;
  result?: { content: string; isError: boolean };
  status: ToolCallStatus;
  startedAt?: number;
  endedAt?: number;
}

export interface ToolGroupModel {
  calls: ToolCall[];
  /** „Lesen ×2 · Suchen · Befehl" (verbs in first-use order). */
  verbs: string;
  errorCount: number;
  /** Known only when the first call and the last result carry a time. */
  durationMs?: number;
  running: boolean;
}

// pi reports its tools in lower case; normalise for target extraction.
const CANONICAL: Record<string, string> = {
  read: "Read",
  grep: "Grep",
  find: "Glob",
  ls: "LS",
  bash: "Bash",
  edit: "Edit",
  write: "Write",
};

export const canonicalTool = (name: string): string => CANONICAL[name] ?? name;

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function obj(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}

/** The file a call reads or writes (Read/Edit/Write/NotebookEdit, pi read/edit/write). */
export function toolPath(name: string, input: unknown): string {
  const i = obj(input);
  const tool = canonicalTool(name);
  if (tool === "Read" || tool === "Edit" || tool === "MultiEdit" || tool === "Write" || tool === "NotebookEdit" || tool === "LS") {
    return str(i.file_path) || str(i.path) || str(i.notebook_path);
  }
  return "";
}

/** Path relative to the project folder when it lies inside it. */
export function relativePath(path: string, cwd?: string): string {
  if (!path || !cwd) return path;
  const base = cwd.replace(/\/+$/, "");
  if (path === base) return ".";
  return path.startsWith(`${base}/`) ? path.slice(base.length + 1) : path;
}

const firstLine = (s: string) => s.split("\n", 1)[0] ?? "";

/** What a call works on, for the one-line row („src/a.ts", „"Date.now" in src", „npm test"). */
export function toolTarget(name: string, input: unknown, cwd?: string): string {
  const i = obj(input);
  const tool = canonicalTool(name);
  const path = toolPath(name, input);
  if (path) return relativePath(path, cwd);
  switch (tool) {
    case "Grep": {
      const pattern = str(i.pattern);
      const where = str(i.path) || str(i.glob);
      return pattern ? `"${pattern}"${where ? ` in ${relativePath(where, cwd)}` : ""}` : "";
    }
    case "Glob":
      return str(i.pattern);
    case "Bash": {
      const command = str(i.command);
      const line = firstLine(command);
      return line.length < command.length ? `${line} …` : line;
    }
    case "WebSearch":
      return str(i.query);
    case "WebFetch":
      return str(i.url);
    case "Task":
      return str(i.description);
    case "TodoWrite":
      return Array.isArray(i.todos) ? `${i.todos.length} ${i.todos.length === 1 ? "Aufgabe" : "Aufgaben"}` : "";
    default: {
      // Unknown tools: the first short string argument.
      for (const v of Object.values(i)) {
        if (typeof v === "string" && v.trim()) return firstLine(v).slice(0, 200);
      }
      return "";
    }
  }
}

export const isToolRow = (m: Msg) => m.role === "tool_use" || m.role === "tool_result";

/**
 * Pairs consecutive tool rows into calls. A result finds its call by
 * `toolUseId`, else the latest call still waiting for one. `live` marks rows
 * of a run that is still going (a call without result is then running).
 */
export function pairToolCalls(rows: { msg: Msg; key: string; live: boolean }[], cwd?: string): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const { msg, key, live } of rows) {
    const meta = metaOf(msg);
    if (msg.role === "tool_use") {
      const name = str(meta.name) || msg.content || "tool";
      calls.push({
        key,
        toolUseId: str(meta.toolUseId) || undefined,
        name,
        label: toolLabel(name),
        target: toolTarget(name, meta.input, cwd),
        input: meta.input,
        status: live ? "running" : "none",
        startedAt: rowTime(msg),
      });
      continue;
    }
    if (msg.role !== "tool_result") continue;
    const id = str(meta.toolUseId);
    let call = id ? calls.find((c) => c.toolUseId === id) : undefined;
    if (!call) call = [...calls].reverse().find((c) => !c.result);
    const result = { content: msg.content || "", isError: meta.isError === true };
    if (!call) {
      // A result without its call (e.g. the call was trimmed): show it alone.
      calls.push({ key, name: "", label: "Ergebnis", target: "", input: undefined, result, status: result.isError ? "error" : "ok", endedAt: rowTime(msg) });
      continue;
    }
    call.result = result;
    call.status = result.isError ? "error" : "ok";
    call.endedAt = rowTime(msg);
  }
  return calls;
}

/** „Lesen ×2 · Suchen · Befehl". */
export function verbSummary(calls: ToolCall[]): string {
  const counts = new Map<string, number>();
  for (const c of calls) counts.set(c.label, (counts.get(c.label) ?? 0) + 1);
  return [...counts].map(([label, n]) => (n > 1 ? `${label} ×${n}` : label)).join(" · ");
}

export function toolGroup(calls: ToolCall[]): ToolGroupModel {
  const first = calls.find((c) => c.startedAt !== undefined)?.startedAt;
  const ends = calls.map((c) => c.endedAt).filter((t): t is number => t !== undefined);
  const last = ends.length ? Math.max(...ends) : undefined;
  const running = calls.some((c) => c.status === "running");
  return {
    calls,
    verbs: verbSummary(calls),
    errorCount: calls.filter((c) => c.status === "error").length,
    durationMs: !running && first !== undefined && last !== undefined && last >= first ? last - first : undefined,
    running,
  };
}

/** „6,2 s" below a minute, „1:02" above (DESIGN: duration only when known). */
export function formatToolDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 60_000) return `${(Math.round(ms / 100) / 10).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** „4 Aktionen" / „1 Aktion". */
export function actionCount(n: number): string {
  return n === 1 ? "1 Aktion" : `${n} Aktionen`;
}

/** The last `max` lines of a text (failed commands show their tail). */
export function tailLines(text: string, max: number): { text: string; hidden: number } {
  const lines = text.replace(/\n+$/, "").split("\n");
  if (lines.length <= max) return { text: lines.join("\n"), hidden: 0 };
  return { text: lines.slice(-max).join("\n"), hidden: lines.length - max };
}

/** The first `max` lines of a text. */
export function headLines(text: string, max: number): { text: string; hidden: number } {
  const lines = text.replace(/\n+$/, "").split("\n");
  if (lines.length <= max) return { text: lines.join("\n"), hidden: 0 };
  return { text: lines.slice(0, max).join("\n"), hidden: lines.length - max };
}

export interface TouchedFile {
  path: string;
  /** Relative to the project folder when inside it. */
  display: string;
  /** M = edited, A = new file. */
  kind: "M" | "A";
  /** Number of Edit/Write calls on it. */
  count: number;
  /** Key of the last tool row for this file (scroll target). */
  lastKey: string;
}

const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "NotebookEdit"]);

/**
 * Files changed in a session, from Edit/Write calls. A Write to a path that
 * was not read or edited before counts as a new file (A); agents read a file
 * before overwriting it, so this is a good signal without file system access.
 */
export function touchedFiles(rows: { msg: Msg; key: string }[], cwd?: string): TouchedFile[] {
  const seen = new Set<string>();
  const files = new Map<string, TouchedFile>();
  for (const { msg, key } of rows) {
    if (msg.role !== "tool_use") continue;
    const meta = metaOf(msg);
    const name = canonicalTool(str(meta.name) || msg.content);
    const path = toolPath(name, meta.input);
    if (!path) continue;
    if (name === "Read" || name === "LS") {
      seen.add(path);
      continue;
    }
    if (!EDIT_TOOLS.has(name) && name !== "Write") continue;
    const prev = files.get(path);
    if (prev) {
      prev.count += 1;
      prev.lastKey = key;
    } else {
      files.set(path, {
        path,
        display: relativePath(path, cwd),
        kind: name === "Write" && !seen.has(path) ? "A" : "M",
        count: 1,
        lastKey: key,
      });
    }
    seen.add(path);
  }
  return [...files.values()];
}
