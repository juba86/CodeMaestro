/**
 * Client side of POST /api/ai/chat with `stream: true`: server-sent events
 * whose `data:` lines carry `{ type, content }` chunks and end with `[DONE]`.
 */

export interface SseState {
  text: string;
  error: string;
  done: boolean;
}

/**
 * Incremental parser for the chat stream. Network chunks don't align with SSE
 * lines, so the trailing partial line is kept until the rest arrives.
 * `push` returns the text appended by this chunk.
 */
export function createChatStreamParser() {
  let buffer = "";
  const state: SseState = { text: "", error: "", done: false };

  function handleLine(rawLine: string): string {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (!line.startsWith("data:")) return "";
    const data = line.slice(5).trimStart();
    if (data === "[DONE]") {
      state.done = true;
      return "";
    }
    try {
      const parsed = JSON.parse(data);
      if (parsed?.type === "error") {
        state.error = typeof parsed.content === "string" && parsed.content ? parsed.content : "Fehler im Antwortstrom";
        return "";
      }
      if (typeof parsed?.content === "string" && parsed.content) {
        state.text += parsed.content;
        return parsed.content;
      }
    } catch {
      /* skip invalid JSON */
    }
    return "";
  }

  return {
    state,
    push(chunk: string): string {
      if (state.done) return "";
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      let added = "";
      for (const l of lines) {
        added += handleLine(l);
        if (state.done) break;
      }
      return added;
    },
    /** Flush the last line when the stream ends without a trailing newline. */
    end(): string {
      const rest = buffer;
      buffer = "";
      return rest && !state.done ? handleLine(rest) : "";
    },
  };
}

export interface ChatParams {
  maxTokens?: number;
  temperature?: number;
}

/**
 * Streams one completion. `onDelta` receives the text so far. Resolves with
 * the text and a stream error, if one ended it; rejects on HTTP errors with
 * the server's message (an AbortError passes through unchanged).
 */
export async function streamChat(opts: {
  provider: string;
  model: string;
  prompt: string;
  apiKey: string;
  baseUrl: string;
  params?: ChatParams;
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
}): Promise<{ text: string; error?: string }> {
  const res = await fetch("/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: opts.prompt }],
      provider: opts.provider,
      model: opts.model,
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl,
      stream: true,
      ...(opts.params?.maxTokens ? { maxTokens: opts.params.maxTokens } : {}),
      ...(opts.params?.temperature != null ? { temperature: opts.params.temperature } : {}),
    }),
    signal: opts.signal,
  });
  if (!res.ok) {
    const e = await res.json().catch(() => null);
    throw new Error(typeof e?.error === "string" ? e.error : `Anfrage fehlgeschlagen (HTTP ${res.status})`);
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error("Keine Antwort erhalten");
  const parser = createChatStreamParser();
  const decoder = new TextDecoder();
  while (!parser.state.done) {
    const { done, value } = await reader.read();
    if (done) {
      const tail = parser.push(decoder.decode());
      const last = parser.end();
      if (tail || last) opts.onDelta?.(parser.state.text);
      break;
    }
    if (parser.push(decoder.decode(value, { stream: true }))) opts.onDelta?.(parser.state.text);
  }
  if (parser.state.done) reader.cancel().catch(() => {});
  return { text: parser.state.text, error: parser.state.error || undefined };
}
