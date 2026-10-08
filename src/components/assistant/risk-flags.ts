// Pure helpers for gate cards (DESIGN.md §6.2.6/§6.2.7): what kind of approval
// a request is, its German title and one-line target, the line count of an
// overwrite, and client-side risk flags for shell commands. The flags are
// heuristics that add warnings; they never allow anything on their own.
import type { ApprovalEvent, DiffPart } from "./types";
import { canonicalTool } from "./tool-calls";

export type ApprovalKind = "edit" | "write_new" | "write_overwrite" | "bash" | "push" | "other";

export type RiskFlag = "deletes" | "sudo" | "network" | "outside" | "git_dir";

export const RISK_FLAG_LABEL: Record<RiskFlag, string> = {
  deletes: "Löscht Dateien",
  sudo: "sudo",
  network: "Netzwerkzugriff",
  outside: "Außerhalb des Projektordners",
  git_dir: "Schreibt in .git",
};

/** `git push …` anywhere in a command chain (also `git -C dir push`). */
export function isGitPush(command: string | undefined): boolean {
  if (!command) return false;
  return /(^|[;&|(]\s*|\s)git(\s+-[cC]\s+\S+|\s+--[\w-]+(=\S+)?)*\s+push\b/.test(command.trim());
}

export function approvalKind(card: Pick<ApprovalEvent, "tool" | "isWrite" | "overwrites" | "command">): ApprovalKind {
  const tool = canonicalTool(card.tool ?? "");
  if (tool === "Bash") return isGitPush(card.command) ? "push" : "bash";
  if (tool === "Write" || (card.isWrite && tool !== "Edit" && tool !== "MultiEdit")) {
    return card.overwrites ? "write_overwrite" : "write_new";
  }
  if (tool === "Edit" || tool === "MultiEdit" || tool === "NotebookEdit") return "edit";
  return "other";
}

const TITLE: Record<ApprovalKind, string> = {
  edit: "Datei bearbeiten?",
  write_new: "Neue Datei anlegen?",
  write_overwrite: "Datei schreiben?",
  bash: "Befehl ausführen?",
  push: "Nach GitHub pushen?",
  other: "Freigabe erforderlich",
};

export function approvalTitle(card: ApprovalEvent): string {
  return TITLE[approvalKind(card)];
}

export function baseName(path: string | undefined): string {
  if (!path) return "";
  const parts = path.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || path;
}

function clip(s: string, max: number): string {
  const line = s.split("\n", 1)[0] ?? "";
  const t = line.length > max ? `${line.slice(0, max - 1)}…` : line;
  return t.length < s.length && !t.endsWith("…") ? `${t} …` : t;
}

/**
 * One line naming what a gate wants: „helpers.ts schreiben", „Befehl: npm test",
 * „Frage vom Agenten", „Plan freigeben".
 */
export function gateTarget(card: ApprovalEvent): string {
  if (card.type === "question_request") return card.kind === "plan" ? "Plan freigeben" : "Frage vom Agenten";
  const file = baseName(card.filePath);
  switch (approvalKind(card)) {
    case "edit":
      return file ? `${file} bearbeiten` : "Datei bearbeiten";
    case "write_new":
      return file ? `${file} anlegen` : "Neue Datei anlegen";
    case "write_overwrite":
      return file ? `${file} schreiben` : "Datei schreiben";
    case "push":
      return "Nach GitHub pushen";
    case "bash":
      return card.command ? `Befehl: ${clip(card.command, 60)}` : "Befehl ausführen";
    default:
      return card.tool ? `${card.tool}${file ? `: ${file}` : ""}` : "Freigabe";
  }
}

/** Announcement for a new gate („Freigabe erforderlich: helpers.ts schreiben"). */
export function gateAnnouncement(card: ApprovalEvent): string {
  if (card.type === "question_request") return card.kind === "plan" ? "Plan wartet auf Freigabe" : "Frage vom Agenten";
  return `Freigabe erforderlich: ${gateTarget(card)}`;
}

function lineCount(text: string): number {
  if (!text) return 1;
  const lines = text.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines.length;
}

/** Lines of the existing file an overwrite replaces (equal + del lines of the diff). */
export function overwriteLineCount(diff: DiffPart[] | undefined): number {
  let n = 0;
  for (const p of diff ?? []) if (p.op !== "add") n += lineCount(p.text);
  return n;
}

// Shell words that reach the network.
const NETWORK = /(^|[\s;&|(`$])(curl|wget|ssh|scp|sftp|rsync|nc|ncat|telnet|ftp)(\s|$)/;
const SUDO = /(^|[\s;&|(`$])(sudo|doas)(\s|$)/;
// rm with -r/-R/-f in any flag cluster (rm -rf, rm -fr, rm -r -f, rm --recursive, rm --force).
const RM = /(^|[\s;&|(`$])rm\s+((-[\w-]*\s+)*)(-[a-zA-Z]*[rRf][a-zA-Z]*|--recursive|--force)\b/;
const GIT_DIR = /(^|[\s"'=/>])\.git(\/|\s|$|["'])/;

function absolutePaths(command: string): string[] {
  const out: string[] = [];
  const re = /(?:^|[\s=:"'(<>])(\/[^\s"'`;|&)<>]*)/g;
  let m: RegExpExecArray | null;
  // URLs ("https://…") are not paths.
  while ((m = re.exec(command))) if (!m[1].startsWith("//")) out.push(m[1]);
  return out;
}

const SAFE_SYSTEM_PATHS = /^\/(dev\/null|dev\/stdout|dev\/stderr|tmp(\/|$)|usr\/(local\/)?bin\/|bin\/|usr\/bin\/env\b)/;

/**
 * Risk flags for a shell command (heuristic, never a security boundary):
 * deletes files, sudo, network access, paths outside the project folder
 * (absolute paths elsewhere or `..`), writes into .git.
 */
export function bashRiskFlags(command: string | undefined, cwd?: string): RiskFlag[] {
  if (!command) return [];
  const flags: RiskFlag[] = [];
  if (RM.test(command)) flags.push("deletes");
  if (SUDO.test(command)) flags.push("sudo");
  if (NETWORK.test(command)) flags.push("network");
  const base = cwd?.replace(/\/+$/, "");
  const outside =
    /(^|[\s/"'=])\.\.(\/|\s|$|["'])/.test(command) ||
    absolutePaths(command).some((p) => {
      if (SAFE_SYSTEM_PATHS.test(p)) return false;
      if (!base) return true;
      return p !== base && !p.startsWith(`${base}/`);
    });
  if (outside) flags.push("outside");
  if (GIT_DIR.test(command)) flags.push("git_dir");
  return flags;
}
