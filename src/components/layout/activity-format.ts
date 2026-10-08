// Pure text helpers for the shell's activity UI (DESIGN.md §5.4): what a
// pending gate is about, chip/badge wording and the server line. Unit-tested.

import type { ActivityPending } from "@/lib/activity";
import { toolLabel } from "@/lib/labels";
import { plural } from "@/lib/format";

export type PendingKind = "edit" | "create" | "write" | "command" | "push" | "question" | "plan" | "tool";

export interface PendingSummary {
  kind: PendingKind;
  /** "Datei schreiben", "Befehl ausführen", "Frage", … */
  label: string;
  /** File name (basename) for file gates, else null. */
  target: string | null;
  /** Full path or command for a title attribute, else null. */
  detail: string | null;
}

/** Last path segment ("src/lib/a.ts" → "a.ts"; Windows separators too). */
export function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const i = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return i >= 0 ? trimmed.slice(i + 1) : trimmed;
}

const FILE_EDIT_TOOLS = new Set(["Edit", "MultiEdit", "NotebookEdit", "edit"]);
const isPush = (command: string) => /(^|[;&|]\s*|\s)git\s+push\b/.test(command.trim());

/** Kind and German label of an open approval or question. */
export function describePending(p: Pick<ActivityPending, "type" | "kind" | "tool" | "filePath" | "command" | "isWrite" | "overwrites">): PendingSummary {
  if (p.type === "question_request") {
    return p.kind === "plan"
      ? { kind: "plan", label: "Plan", target: null, detail: null }
      : { kind: "question", label: "Frage", target: null, detail: null };
  }
  const tool = p.tool ?? "";
  // The tool decides the kind; `command` alone only for events without one
  // (other tools carry their target in `command` too, e.g. a URL or MCP input).
  if (tool === "Bash" || tool === "bash" || (!tool && p.command !== undefined)) {
    const command = (p.command ?? "").trim();
    if (command && isPush(command)) return { kind: "push", label: "Nach GitHub pushen", target: null, detail: command };
    return { kind: "command", label: "Befehl ausführen", target: null, detail: command || null };
  }
  const file = p.filePath ? basename(p.filePath) : null;
  if (tool && tool !== "Write" && tool !== "write" && !FILE_EDIT_TOOLS.has(tool)) {
    // WebFetch, a read outside the project, an MCP tool …
    return { kind: "tool", label: toolLabel(tool), target: file, detail: p.filePath ?? p.command?.trim() ?? null };
  }
  if (tool === "Write" || tool === "write" || p.isWrite) {
    if (p.overwrites === false) return { kind: "create", label: "Neue Datei anlegen", target: file, detail: p.filePath ?? null };
    return { kind: "write", label: "Datei schreiben", target: file, detail: p.filePath ?? null };
  }
  if (FILE_EDIT_TOOLS.has(tool) || file) {
    return { kind: "edit", label: "Datei bearbeiten", target: file, detail: p.filePath ?? null };
  }
  return { kind: "tool", label: tool ? toolLabel(tool) : "Freigabe", target: null, detail: null };
}

/** "Datei schreiben: helpers.ts" / "Frage". */
export function pendingTitle(s: PendingSummary): string {
  return s.target ? `${s.label}: ${s.target}` : s.label;
}

/** "1 läuft" · "2 laufen". */
export function runningText(n: number): string {
  return `${n} ${plural(n, "läuft", "laufen")}`;
}

/** "1 Freigabe" · "3 Freigaben". */
export function waitingText(n: number): string {
  return `${n} ${plural(n, "Freigabe", "Freigaben")}`;
}

/**
 * Accessible name of the activity chip. It contains the chip's visible text
 * ("1 läuft", "2 Freigaben") so speech input can target it (WCAG 2.5.3):
 * "Aktivität: 1 läuft, 2 Freigaben offen".
 */
export function activityAriaLabel(running: number, waiting: number): string {
  const parts: string[] = [];
  if (running > 0) parts.push(runningText(running));
  if (waiting > 0) parts.push(`${waitingText(waiting)} offen`);
  return parts.length > 0 ? `Aktivität: ${parts.join(", ")}` : "Aktivität: gerade läuft nichts";
}

/** "1 offene Freigabe" · "3 offene Freigaben" (tab bar / sidebar badge). */
export function openGatesLabel(n: number): string {
  return `${n} ${plural(n, "offene Freigabe", "offene Freigaben")}`;
}

/** Short server name for the sidebar: first DNS label, IP addresses unchanged. */
export function hostLabel(hostname: string): string {
  const h = hostname.trim();
  if (!h) return "";
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(":") || h.startsWith("[")) return h;
  return h.split(".")[0] || h;
}
