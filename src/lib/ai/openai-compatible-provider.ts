import type { AIProvider, SendMessageParams, StreamChunk, ModelInfo } from "./types";

export interface OpenAICompatConfig {
  providerId: string; // catalog id (used as ModelInfo.provider)
  baseUrl: string; // REST base, e.g. https://api.openai.com/v1 (no trailing slash)
  apiKey?: string; // optional for local servers
  noModelsEndpoint?: boolean;
}

function authHeaders(apiKey?: string): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) h.Authorization = `Bearer ${apiKey}`;
  return h;
}

function trimBase(url: string): string {
  return url.replace(/\/$/, "");
}

/**
 * Fetches the model list from an OpenAI-compatible `GET /models` endpoint.
 * Returns [] on any failure so the caller can fall back to a static list.
 */
export async function fetchOpenAICompatModels(
  providerId: string,
  baseUrl: string,
  apiKey?: string
): Promise<ModelInfo[]> {
  try {
    const res = await fetch(`${trimBase(baseUrl)}/models`, {
      headers: authHeaders(apiKey),
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: { id: string; name?: string }[] };
    return (data.data || [])
      .map((m) => ({
        id: m.id,
        name: m.name || m.id,
        provider: providerId,
        maxTokens: 8192,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  } catch {
    return [];
  }
}

/**
 * A single provider implementation covering every OpenAI-compatible HTTP API:
 * OpenAI, OpenRouter, Groq, DeepSeek, Mistral, xAI, Together, Perplexity, and
 * local servers (LM Studio, Jan, llama.cpp, vLLM, LocalAI, …). Configured per
 * instance with a base URL and optional key.
 */
export class OpenAICompatibleProvider implements AIProvider {
  name: string;
  private cfg: OpenAICompatConfig;

  constructor(cfg: OpenAICompatConfig) {
    this.cfg = { ...cfg, baseUrl: trimBase(cfg.baseUrl) };
    this.name = cfg.providerId;
  }

  getModels(): ModelInfo[] {
    return [];
  }

  private body(params: SendMessageParams, stream: boolean) {
    const messages: { role: string; content: string }[] = [];
    if (params.systemPrompt) messages.push({ role: "system", content: params.systemPrompt });
    for (const m of params.messages) messages.push({ role: m.role, content: m.content });
    const body: Record<string, unknown> = {
      model: params.model || "gpt-4o-mini",
      messages,
      stream,
    };
    // OpenAI's own API deprecated max_tokens (reasoning models reject it with a
    // 400) and its o-series / gpt-5 reasoning models reject custom temperature.
    // Other compatible servers still expect the classic fields.
    const isOpenAI = this.cfg.providerId === "openai";
    const reasoning = isOpenAI && /^(o\d|gpt-5)/.test(String(body.model));
    if (params.maxTokens != null) body[isOpenAI ? "max_completion_tokens" : "max_tokens"] = params.maxTokens;
    if (params.temperature != null && !reasoning) body.temperature = params.temperature;
    return body;
  }

  async sendMessage(params: SendMessageParams): Promise<string> {
    const res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: authHeaders(this.cfg.apiKey),
      cache: "no-store",
      body: JSON.stringify(this.body(params, false)),
    });
    if (!res.ok) {
      throw new Error(`${this.name} error ${res.status}: ${(await res.text()).slice(0, 500)}`);
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content || "";
  }

  async *streamMessage(params: SendMessageParams): AsyncGenerator<StreamChunk> {
    const res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: authHeaders(this.cfg.apiKey),
      cache: "no-store",
      body: JSON.stringify(this.body(params, true)),
    });
    if (!res.ok || !res.body) {
      throw new Error(`${this.name} error ${res.status}: ${(await res.text()).slice(0, 500)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const emit = function* (line: string): Generator<StreamChunk> {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) return;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") return;
      try {
        const obj = JSON.parse(payload) as {
          choices?: { delta?: { content?: string } }[];
        };
        const piece = obj.choices?.[0]?.delta?.content;
        if (piece) yield { type: "text", content: piece };
      } catch {
        // ignore malformed partial lines
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) yield* emit(line);
    }
    if (buffer.trim()) yield* emit(buffer);
    yield { type: "done", content: "" };
  }

  async validateCredentials(apiKey: string): Promise<boolean> {
    const key = apiKey || this.cfg.apiKey;
    // Prefer a cheap GET /models; if the provider has none, do a 1-token chat.
    if (!this.cfg.noModelsEndpoint) {
      try {
        const res = await fetch(`${this.cfg.baseUrl}/models`, {
          headers: authHeaders(key),
          cache: "no-store",
        });
        if (res.ok) return true;
        // Some gateways 404 /models but still chat — fall through on 404 only.
        if (res.status !== 404) return false;
      } catch {
        return false;
      }
    }
    try {
      const res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: authHeaders(key),
        cache: "no-store",
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 1,
        }),
      });
      // 200 OK or even a 400 "model not found" means auth succeeded.
      return res.ok || res.status === 400;
    } catch {
      return false;
    }
  }
}
