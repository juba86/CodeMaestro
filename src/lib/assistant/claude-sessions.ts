import { promises as fs } from "fs";
import os from "os";
import path from "path";

// Claude Code's own conversations of a project folder, so a new CodeMaestro
// session can pick one up with `claude --resume <id>` ("Projekt fortsetzen").
// Claude Code stores each conversation as JSONL at
//   ${CLAUDE_CONFIG_DIR || ~/.claude}/projects/<slug>/<sessionId>.jsonl
// where <slug> is the absolute cwd with every char outside [a-zA-Z0-9] replaced
// by "-". Files can be many MB, so only their head (and a little of their tail,
// where newer versions append title entries) is ever read, and a malformed line
// is skipped rather than thrown on. Callers validate the cwd (resolveWorkdir)
// before passing it in.

export interface ClaudeSessionInfo {
  /** Claude Code session id (what `--resume` takes). */
  id: string;
  /** Rename > AI title > first real user prompt > summary; "" when none was found. */
  title: string;
  /** Last change of the conversation file (ISO). */
  updatedAt: string;
  /** User prompts + assistant replies; only when the whole file was read. */
  messageCount?: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_FILE_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

/** Bytes read from the start of a conversation (first prompt, cwd, early titles). */
const HEAD_BYTES = 256 * 1024;
/** Bytes read from the end of a larger file (the latest rename / AI title). */
const TAIL_BYTES = 64 * 1024;
/** Bytes read per file while looking for a project dir by its `cwd`. */
const PROBE_BYTES = 64 * 1024;
/** Files probed per project dir before giving up on finding its `cwd`. */
const PROBE_FILES = 3;
/** Uncached project dirs probed per lookup (the cache makes repeats free). */
const MAX_PROBED_DIRS = 200;
/** Conversation files considered per project dir (newest first). */
const MAX_FILES = 5000;
const MAX_LIMIT = 50;
const TITLE_MAX = 200;

/**
 * First user prompts of CodeMaestro's own one-shot orchestrator runs (planner,
 * conductor, role-framed workers, reviewer, fixer, synthesis). Older versions
 * persisted them as Claude Code conversations in the project dir; they are not
 * conversations a user would continue.
 */
const INTERNAL_PROMPT_PREFIXES = [
  "You are an orchestration planner",
  "You are the conductor of a small team",
  "You orchestrated multiple AI workers",
  "You are the ",
  "Review the work",
  "You are reviewing",
  "Address the review findings",
];

/** Wrapped/system texts Claude Code stores as user lines that are not a typed prompt. */
const NON_PROMPT_PREFIXES = ["<command-", "<local-command", "<system-reminder", "Caveat:", "[Request interrupted"];

/** True for a Claude Code session id (a UUID). */
export function isClaudeSessionId(id: unknown): id is string {
  return typeof id === "string" && UUID_RE.test(id);
}

/** Claude Code's config dir: CLAUDE_CONFIG_DIR or ~/.claude. */
export function claudeConfigDir(): string {
  const env = process.env.CLAUDE_CONFIG_DIR?.trim();
  return env ? path.resolve(env) : path.join(os.homedir(), ".claude");
}

export function claudeProjectsDir(): string {
  return path.join(claudeConfigDir(), "projects");
}

/** "/home/user/CodeMaestro" → "-home-user-CodeMaestro" (never contains a separator). */
export function claudeProjectSlug(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

/** The project dir Claude Code uses for this cwd (when the path is not too long to be hashed). */
export function claudeProjectDir(cwd: string): string {
  return path.join(claudeProjectsDir(), claudeProjectSlug(cwd));
}

// --- reading ----------------------------------------------------------------------

type Entry = Record<string, unknown>;

/** Reads `length` bytes at `start` (fewer at EOF). */
async function readSlice(file: string, start: number, length: number): Promise<string> {
  const fh = await fs.open(file, "r");
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buf, 0, length, start);
    return buf.subarray(0, bytesRead).toString("utf8");
  } finally {
    await fh.close().catch(() => {});
  }
}

/** JSON objects of a JSONL chunk; partial lines at cut edges and malformed lines are dropped. */
function parseLines(text: string, { cutStart, cutEnd }: { cutStart: boolean; cutEnd: boolean }): Entry[] {
  const lines = text.split("\n");
  if (cutStart) lines.shift();
  if (cutEnd) lines.pop();
  const out: Entry[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t[0] !== "{") continue;
    try {
      const v: unknown = JSON.parse(t);
      if (v && typeof v === "object" && !Array.isArray(v)) out.push(v as Entry);
    } catch {
      /* malformed or cut line */
    }
  }
  return out;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** The text a user line was typed with, or "" for meta/tool results/wrapped commands. */
function promptText(entry: Entry): string {
  if (entry.type !== "user" || entry.isMeta === true || entry.isSidechain === true || entry.isCompactSummary === true) return "";
  const message = entry.message;
  if (!message || typeof message !== "object") return "";
  const content = (message as Entry).content;
  const isPrompt = (t: string) => {
    const s = t.trim();
    return s !== "" && !NON_PROMPT_PREFIXES.some((p) => s.startsWith(p));
  };
  if (typeof content === "string") return isPrompt(content) ? content.trim() : "";
  if (!Array.isArray(content)) return "";
  // Only text blocks count: a line of tool_result/image blocks is no prompt.
  const texts = content
    .map((b) => (b && typeof b === "object" && (b as Entry).type === "text" ? str((b as Entry).text) : ""))
    .filter(isPrompt);
  return texts.join("\n").trim();
}

function clipTitle(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX - 1)}…` : t;
}

interface Scan {
  cwd: string;
  firstPrompt: string;
  customTitle: string;
  aiTitle: string;
  summary: string;
  /** A user/assistant line outside a sidechain (subagent) exists. */
  hasMain: boolean;
  prompts: number;
  replies: Set<string>;
}

function emptyScan(): Scan {
  return { cwd: "", firstPrompt: "", customTitle: "", aiTitle: "", summary: "", hasMain: false, prompts: 0, replies: new Set() };
}

function scanEntries(entries: Entry[], scan: Scan): void {
  for (const e of entries) {
    const type = e.type;
    if (!scan.cwd && typeof e.cwd === "string") scan.cwd = e.cwd;
    if (type === "custom-title" && str(e.customTitle).trim()) scan.customTitle = str(e.customTitle);
    else if (type === "ai-title" && str(e.aiTitle).trim()) scan.aiTitle = str(e.aiTitle);
    else if (type === "summary" && !scan.summary && str(e.summary).trim()) scan.summary = str(e.summary);
    else if ((type === "user" || type === "assistant") && e.isSidechain !== true) {
      scan.hasMain = true;
      if (type === "user") {
        const text = promptText(e);
        if (text) {
          scan.prompts++;
          if (!scan.firstPrompt) scan.firstPrompt = text;
        }
      } else {
        // One API response is stored as one line per content block.
        const m = e.message && typeof e.message === "object" ? (e.message as Entry) : null;
        scan.replies.add(str(m?.id) || str(e.uuid) || String(scan.replies.size));
      }
    }
  }
}

/** True when two paths name the same directory (the recorded cwd may be a symlinked path). */
async function sameDir(recorded: string, cwd: string): Promise<boolean> {
  if (recorded === cwd) return true;
  try {
    return (await fs.realpath(recorded)) === cwd;
  } catch {
    return false;
  }
}

/**
 * Reads one conversation file into a list entry, or null when it is no
 * conversation to continue: empty or sidechain-only, recorded for another
 * folder (two folders can share a slug: "my-app" / "my_app"), or one of
 * CodeMaestro's own orchestrator runs.
 */
async function readConversation(file: string, id: string, cwd: string): Promise<ClaudeSessionInfo | null> {
  let stat;
  try {
    stat = await fs.stat(file);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  const scan = emptyScan();
  const complete = stat.size <= HEAD_BYTES;
  try {
    scanEntries(parseLines(await readSlice(file, 0, HEAD_BYTES), { cutStart: false, cutEnd: !complete }), scan);
    if (!complete) {
      // Renames and AI titles are appended over time: the latest sits near the end.
      const tail = emptyScan();
      const start = Math.max(HEAD_BYTES, stat.size - TAIL_BYTES);
      scanEntries(parseLines(await readSlice(file, start, stat.size - start), { cutStart: true, cutEnd: false }), tail);
      if (tail.customTitle) scan.customTitle = tail.customTitle;
      if (tail.aiTitle) scan.aiTitle = tail.aiTitle;
    }
  } catch {
    return null;
  }
  if (!scan.hasMain) return null;
  if (scan.cwd && !(await sameDir(scan.cwd, cwd))) return null;
  if (scan.firstPrompt && INTERNAL_PROMPT_PREFIXES.some((p) => scan.firstPrompt.startsWith(p))) return null;
  return {
    id,
    title: clipTitle(scan.customTitle || scan.aiTitle || scan.firstPrompt || scan.summary),
    updatedAt: stat.mtime.toISOString(),
    ...(complete ? { messageCount: scan.prompts + scan.replies.size } : {}),
  };
}

// --- finding the project dir ------------------------------------------------------------

async function isDir(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** Project dir path → the (resolved) cwd its conversations were recorded in (null = none found). */
const dirCwdCache = new Map<string, string | null>();

/** The cwd recorded in a project dir's conversations (first few files, head only). */
async function probeDirCwd(dir: string): Promise<string | null | undefined> {
  if (dirCwdCache.has(dir)) return dirCwdCache.get(dir);
  let names: string[];
  try {
    names = (await fs.readdir(dir)).filter((n) => SESSION_FILE_RE.test(n)).slice(0, PROBE_FILES);
  } catch {
    return undefined;
  }
  if (names.length === 0) return undefined; // nothing to tell yet: probe again next time
  for (const name of names) {
    try {
      const entries = parseLines(await readSlice(path.join(dir, name), 0, PROBE_BYTES), { cutStart: false, cutEnd: true });
      const hit = entries.find((e) => typeof e.cwd === "string");
      if (hit) {
        // Stored resolved, so later lookups compare strings without a syscall.
        const recorded = hit.cwd as string;
        const real = await fs.realpath(recorded).catch(() => recorded);
        dirCwdCache.set(dir, real);
        return real;
      }
    } catch {
      /* unreadable file: try the next */
    }
  }
  dirCwdCache.set(dir, null);
  return null;
}

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/**
 * The project dirs holding this cwd's conversations: the exact slug dir, or —
 * when it is missing (newer Claude Code versions shorten long slugs with a hash)
 * — the dirs whose conversations record this cwd. The fallback probes dirs
 * sharing the longest slug prefix first and caches what it learnt.
 */
export async function claudeProjectDirs(cwd: string): Promise<string[]> {
  const exact = claudeProjectDir(cwd);
  if (await isDir(exact)) return [exact];
  const root = claudeProjectsDir();
  let names: string[];
  try {
    names = (await fs.readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
  const slug = claudeProjectSlug(cwd);
  names.sort((a, b) => commonPrefix(b, slug) - commonPrefix(a, slug));
  const out: string[] = [];
  let probed = 0;
  for (const name of names) {
    const dir = path.join(root, name);
    if (!dirCwdCache.has(dir)) {
      if (probed >= MAX_PROBED_DIRS) continue;
      probed++;
    }
    if ((await probeDirCwd(dir)) === cwd) out.push(dir);
  }
  return out;
}

/** Drops what was learnt about project dirs (tests). */
export function resetClaudeSessionCaches(): void {
  dirCwdCache.clear();
}

// --- public API ----------------------------------------------------------------------

/**
 * Claude Code conversations of a folder, newest first (by file mtime), at most
 * `limit` (default 20). Never throws for unreadable or malformed files.
 */
export async function listClaudeSessions(cwd: string, { limit = 20 }: { limit?: number } = {}): Promise<ClaudeSessionInfo[]> {
  const max = Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit) || 20));
  const files = new Map<string, { file: string; mtimeMs: number }>();
  for (const dir of await claudeProjectDirs(cwd)) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    const names = entries.filter((e) => e.isFile() && SESSION_FILE_RE.test(e.name)).map((e) => e.name).slice(0, MAX_FILES);
    const stats = await Promise.all(
      names.map(async (name) => {
        const file = path.join(dir, name);
        const st = await fs.stat(file).catch(() => null);
        return st ? { id: name.slice(0, -".jsonl".length), file, mtimeMs: st.mtimeMs } : null;
      })
    );
    for (const s of stats) {
      if (!s) continue;
      const seen = files.get(s.id);
      if (!seen || seen.mtimeMs < s.mtimeMs) files.set(s.id, { file: s.file, mtimeMs: s.mtimeMs });
    }
  }
  const ordered = [...files.entries()].sort((a, b) => b[1].mtimeMs - a[1].mtimeMs);
  const out: ClaudeSessionInfo[] = [];
  // Skipped files (orchestrator runs, empty ones) are replaced by older ones,
  // but only a bounded number of files is ever read.
  const maxRead = max * 3;
  for (let i = 0; i < ordered.length && i < maxRead && out.length < max; ) {
    const batch = ordered.slice(i, Math.min(i + (max - out.length), maxRead));
    i += batch.length;
    const infos = await Promise.all(batch.map(([id, f]) => readConversation(f.file, id, cwd)));
    for (const info of infos) if (info && out.length < max) out.push(info);
  }
  return out;
}

/** One conversation of a folder (same rules as the list), or null when it is not there. */
export async function readClaudeSession(cwd: string, id: string): Promise<ClaudeSessionInfo | null> {
  if (!isClaudeSessionId(id)) return null;
  for (const dir of await claudeProjectDirs(cwd)) {
    const info = await readConversation(path.join(dir, `${id}.jsonl`), id, cwd);
    if (info) return info;
  }
  return null;
}

/** True when the folder has this Claude Code conversation (and it can be continued). */
export async function claudeSessionExists(cwd: string, id: string): Promise<boolean> {
  return (await readClaudeSession(cwd, id)) !== null;
}
