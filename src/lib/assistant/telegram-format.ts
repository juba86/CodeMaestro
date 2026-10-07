// Pure, dependency-free helpers for the Telegram bridge. Kept separate from
// telegram.ts (which pulls in prisma/runner) so they can be unit-tested in
// isolation.

const MAX_MSG = 4096; // Telegram hard limit per message
const MAX_CALLBACK_BYTES = 64; // Telegram limit for inline-button callback_data

// Lengths are UTF-16 code units (JS string length). A cut between the two
// halves of a surrogate pair (most emoji) leaves a lone surrogate, which
// Telegram rejects as invalid UTF-8 — so every cut is moved off such a pair.
function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** The first at most `max` code units of `text`, never splitting a surrogate pair. */
export function sliceHead(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = Math.max(0, max);
  if (end > 0 && isLowSurrogate(text.charCodeAt(end))) end--;
  return text.slice(0, end);
}

/** The last at most `max` code units of `text`, never splitting a surrogate pair. */
export function sliceTail(text: string, max: number): string {
  if (text.length <= max) return text;
  let start = text.length - Math.max(0, max);
  if (isLowSurrogate(text.charCodeAt(start))) start++;
  return text.slice(start);
}

/** Splits text into Telegram-sized chunks, preferring to break on newlines. */
export function splitForTelegram(text: string, max = MAX_MSG): string[] {
  if (!text) return [];
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.5) cut = sliceHead(rest, max).length || max; // no good newline — hard cut
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, "");
  }
  if (rest.length) out.push(rest);
  return out;
}

/** The last `max` characters of a growing log, marked as truncated. */
export function tailForTelegram(text: string, max = MAX_MSG): string {
  if (text.length <= max) return text;
  return `…${sliceTail(text, max - 1)}`;
}

/** Truncates text to `max` characters with a visible marker. */
export function clipText(text: string, max: number, marker = "… (gekürzt)"): string {
  if (text.length <= max) return text;
  return `${sliceHead(text, Math.max(0, max - marker.length))}${marker}`;
}

export interface ParsedCommand {
  command: string; // without leading slash, lowercased; "" if not a command
  args: string; // everything after the command
}

/** Parses a Telegram text into a command + args. Handles `/cmd@botname`. */
export function parseCommand(text: string): ParsedCommand {
  const t = (text || "").trim();
  if (!t.startsWith("/")) return { command: "", args: t };
  const m = t.match(/^\/([A-Za-z0-9_]+)(?:@\w+)?\s*([\s\S]*)$/);
  if (!m) return { command: "", args: t };
  return { command: m[1].toLowerCase(), args: m[2].trim() };
}

/** Whether a chat id is permitted to drive the bot. Empty allowlist = nobody. */
export function isChatAllowed(chatId: number, allowed: number[]): boolean {
  return allowed.includes(chatId);
}

/** A short one-line summary of a tool call for the Telegram transcript. */
export function formatToolLine(name?: string, input?: unknown): string {
  const n = name || "tool";
  const i = input as { file_path?: string; command?: string; pattern?: string } | undefined;
  const detail = i?.file_path || i?.command || i?.pattern || "";
  const short = detail ? ` ${sliceHead(String(detail), 80)}` : "";
  return `🔧 ${n}${short}`;
}

/**
 * Joins callback parts with ":" — or returns null when the result would exceed
 * Telegram's 64-byte callback_data limit (the button would be rejected).
 */
export function callbackData(...parts: Array<string | number>): string | null {
  const data = parts.join(":");
  return new TextEncoder().encode(data).length <= MAX_CALLBACK_BYTES ? data : null;
}

// --- Approval / question cards ------------------------------------------------

export interface ApprovalCardInput {
  tool?: string;
  command?: string;
  filePath?: string;
  overwrites?: boolean;
  diff?: Array<{ op: "equal" | "add" | "del"; text: string }>;
  expiresAt?: number;
}

/** Minutes left until an approval auto-denies, as a short German hint. */
export function expiryHint(expiresAt: number | undefined, now = Date.now()): string {
  if (!expiresAt) return "";
  const min = Math.max(0, Math.round((expiresAt - now) / 60_000));
  return `⏳ Timeout in ${min} min`;
}

/** Text of a tool-approval card (Bash command or file diff preview). */
export function formatApprovalText(e: ApprovalCardInput, now = Date.now()): string {
  const head = e.tool === "Bash"
    ? `🔸 Freigabe (Bash):\n${clipText(e.command || "", 1500)}`
    : `🔸 Freigabe: ${e.tool || "Tool"} ${e.filePath || ""}${e.overwrites ? " (überschreibt bestehende Datei)" : ""}`;
  const diffPreview = clipText(
    (e.diff || [])
      .map((d) => (d.op === "add" ? "+ " : d.op === "del" ? "- " : "  ") + d.text)
      .join("\n"),
    1500
  );
  const hint = expiryHint(e.expiresAt, now);
  return [head.trimEnd(), diffPreview, hint].filter(Boolean).join("\n\n");
}

export interface QuestionCardInput {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: Array<{ label: string; description?: string }>;
}

/** Text of one AskUserQuestion question (options are listed, buttons carry the labels). */
export function formatQuestionText(q: QuestionCardInput, index: number, total: number): string {
  const counter = total > 1 ? ` (${index + 1}/${total})` : "";
  const lines = [`❓ Rückfrage${counter}`];
  if (q.header) lines.push(q.header);
  if (q.question) lines.push(q.question);
  if (q.multiSelect) lines.push("(Mehrfachauswahl — für mehrere Optionen per Text antworten)");
  if (q.options.length) {
    lines.push("");
    q.options.forEach((o, i) => {
      lines.push(`${i + 1}. ${o.label}${o.description ? ` — ${o.description}` : ""}`);
    });
  }
  lines.push("", q.options.length ? "Tippe eine Option oder antworte mit Text." : "Antworte mit Text.");
  return clipText(lines.join("\n"), MAX_MSG - 200);
}

/** Text of an ExitPlanMode card. */
export function formatPlanText(plan: string): string {
  const body = clipText(plan.trim() || "(leerer Plan)", MAX_MSG - 400, "\n… (gekürzt — vollständig in der PWA)");
  return `📋 Plan freigeben\n\n${body}\n\nOder antworte mit Text, um Änderungen zu wünschen.`;
}

/** Short button label (Telegram truncates long labels badly on phones). */
export function buttonLabel(text: string, max = 40): string {
  const t = text.replace(/\s+/g, " ").trim() || "—";
  return t.length > max ? `${sliceHead(t, max - 1)}…` : t;
}

/**
 * Reason text that answers an AskUserQuestion (same convention as the PWA:
 * the question is "denied" with the user's answers as the reason).
 */
export function buildAnswerReason(answers: Array<{ label: string; answer: string }>): string {
  return `Der Nutzer hat geantwortet:\n${answers.map((a) => `- ${a.label}: ${a.answer}`).join("\n")}`;
}

export const PLAN_REJECT_REASON = "Der Nutzer hat den Plan abgelehnt. Bitte überarbeite ihn und frage ggf. nach.";

// --- /loop --------------------------------------------------------------------

export interface LoopArgs {
  prompt: string;
  maxIterations: number;
  intervalSec: number;
}

export const LOOP_DEFAULT_ITERATIONS = 10;
export const LOOP_MAX_ITERATIONS = 100;
export const LOOP_MAX_INTERVAL_SEC = 86_400;

/**
 * Parses `/loop [n] [interval] <task>` — e.g. `/loop 5 fix the tests`,
 * `/loop 10m check the deploy`, `/loop 3 30s …`. Leading tokens may come in any
 * order. Returns null when no task is given or a value is out of range.
 */
export function parseLoopArgs(args: string): LoopArgs | null {
  let rest = (args || "").trim();
  let maxIterations: number | null = null;
  let intervalSec: number | null = null;

  for (;;) {
    const m = rest.match(/^(\S+)(?:\s+([\s\S]*))?$/);
    if (!m) break;
    const tok = m[1];
    if (maxIterations === null && /^\d{1,4}$/.test(tok)) {
      maxIterations = Number(tok);
    } else if (intervalSec === null && /^\d{1,6}[smh]$/i.test(tok)) {
      const n = Number(tok.slice(0, -1));
      const unit = tok.slice(-1).toLowerCase();
      intervalSec = unit === "h" ? n * 3600 : unit === "m" ? n * 60 : n;
    } else {
      break;
    }
    rest = (m[2] || "").trim();
  }

  if (!rest) return null;
  const iterations = maxIterations ?? LOOP_DEFAULT_ITERATIONS;
  if (iterations < 1 || iterations > LOOP_MAX_ITERATIONS) return null;
  if ((intervalSec ?? 0) > LOOP_MAX_INTERVAL_SEC) return null;
  return { prompt: rest, maxIterations: iterations, intervalSec: intervalSec ?? 0 };
}

export { MAX_MSG, MAX_CALLBACK_BYTES };
