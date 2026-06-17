// Pure, dependency-free helpers for the Telegram bridge. Kept separate from
// telegram.ts (which pulls in prisma/runner) so they can be unit-tested in
// isolation.

const MAX_MSG = 4096; // Telegram hard limit per message

/** Splits text into Telegram-sized chunks, preferring to break on newlines. */
export function splitForTelegram(text: string, max = MAX_MSG): string[] {
  if (!text) return [];
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.5) cut = max; // no good newline — hard cut
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, "");
  }
  if (rest.length) out.push(rest);
  return out;
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
  const short = detail ? ` ${String(detail).slice(0, 80)}` : "";
  return `🔧 ${n}${short}`;
}

export { MAX_MSG };
