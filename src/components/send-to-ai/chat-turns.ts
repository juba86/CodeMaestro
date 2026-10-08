/**
 * Conversation state of „An KI senden" (per API): the prompt, the answers and
 * follow-up questions, and the history that goes to POST /api/ai/chat.
 */

export type TurnStatus = "streaming" | "done" | "error" | "stopped";

export type ChatTurn =
  | { id: string; role: "user"; content: string }
  | {
      id: string;
      role: "assistant";
      content: string;
      status: TurnStatus;
      provider: string;
      model: string;
      /** German error text (see chatErrorMessage). */
      error?: string;
      /** The error is fixed under Einstellungen → Provider. */
      fixInSettings?: boolean;
    };

export interface ApiMessage {
  role: "user" | "assistant";
  content: string;
}

/** chatRequestSchema accepts at most 50 messages per request. */
export const MAX_CHAT_MESSAGES = 50;

/**
 * The history to send before the next question: complete exchanges only. An
 * exchange whose answer is empty (failed, or stopped before the first token)
 * is left out, since the API rejects empty messages and would otherwise see
 * two questions in a row.
 */
export function historyForApi(turns: readonly ChatTurn[]): ApiMessage[] {
  const out: ApiMessage[] = [];
  for (let i = 0; i < turns.length; i++) {
    const q = turns[i];
    if (q.role !== "user") continue;
    const a = turns[i + 1];
    if (!a || a.role !== "assistant" || a.status === "streaming" || !a.content.trim()) continue;
    out.push({ role: "user", content: q.content }, { role: "assistant", content: a.content });
    i++;
  }
  return out;
}

/** Whether one more question fits into a request (history + the question). */
export function canAskFollowUp(turns: readonly ChatTurn[]): boolean {
  return historyForApi(turns).length + 1 <= MAX_CHAT_MESSAGES;
}

/** The first question of the conversation (the prompt it started with), if any. */
export function openingPrompt(turns: readonly ChatTurn[]): string | null {
  const first = turns[0];
  return first && first.role === "user" ? first.content : null;
}

/**
 * German text for errors from /api/ai/chat. The route answers some cases in
 * English; the missing key is the one users can fix themselves.
 */
export function chatErrorMessage(raw: string, providerLabel: string): string {
  const text = raw.trim();
  if (/no api key configured/i.test(text)) {
    return `Kein API-Schlüssel für ${providerLabel} hinterlegt. Trag ihn in den Einstellungen unter „Provider“ ein.`;
  }
  if (/valid http\(s\) base url/i.test(text)) {
    return `Für ${providerLabel} fehlt eine gültige Basis-URL. Trag sie in den Einstellungen unter „Provider“ ein.`;
  }
  if (/failed to fetch|networkerror|load failed/i.test(text)) {
    return "Keine Verbindung zum Server.";
  }
  return text || "Anfrage fehlgeschlagen.";
}

/** Whether an error message is the kind fixed under Einstellungen → Provider. */
export function isSettingsError(raw: string): boolean {
  return /no api key configured|valid http\(s\) base url/i.test(raw);
}
