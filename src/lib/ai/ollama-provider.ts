import type {
  AIProvider,
  SendMessageParams,
  StreamChunk,
  ModelInfo,
} from "./types";

export const OLLAMA_BASE_URL =
  process.env.OLLAMA_BASE_URL?.replace(/\/$/, "") || "http://localhost:11434";

interface OllamaTagModel {
  name: string;
  details?: {
    family?: string;
    context_length?: number;
    parameter_size?: string;
  };
  capabilities?: string[];
}

function isChatModel(m: OllamaTagModel): boolean {
  // Exclude embedding-only models (e.g. bge-m3) — they cannot do chat.
  if (m.capabilities?.includes("embedding") && !m.capabilities.includes("completion")) {
    return false;
  }
  if (m.details?.family === "bert") return false;
  if (/(^|[/_-])(embed|bge)/i.test(m.name)) return false;
  return true;
}

/**
 * Fetches the list of installed Ollama models from the local daemon.
 * Returns [] if Ollama is unreachable so the UI degrades gracefully.
 */
export async function fetchOllamaModels(): Promise<ModelInfo[]> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: OllamaTagModel[] };
    return (data.models || [])
      .filter(isChatModel)
      .map((m) => {
        const size = m.details?.parameter_size ? ` (${m.details.parameter_size})` : "";
        return {
          id: m.name,
          name: `${m.name}${size}`,
          provider: "ollama" as const,
          maxTokens: m.details?.context_length || 8192,
        };
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  } catch {
    return [];
  }
}

export class OllamaProvider implements AIProvider {
  name = "ollama" as const;

  // Ollama needs no API key; the constructor signature is kept for the factory.
  constructor(_apiKey?: string) {}

  getModels(): ModelInfo[] {
    // Models are dynamic — fetched via fetchOllamaModels() in the models route.
    return [];
  }

  private buildMessages(params: SendMessageParams) {
    const msgs: { role: string; content: string }[] = [];
    if (params.systemPrompt) {
      msgs.push({ role: "system", content: params.systemPrompt });
    }
    for (const m of params.messages) {
      msgs.push({ role: m.role, content: m.content });
    }
    return msgs;
  }

  private buildOptions(params: SendMessageParams) {
    const options: Record<string, number> = {};
    if (params.temperature != null) options.temperature = params.temperature;
    if (params.maxTokens != null) options.num_predict = params.maxTokens;
    return options;
  }

  async sendMessage(params: SendMessageParams): Promise<string> {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        model: params.model || "llama3",
        messages: this.buildMessages(params),
        stream: false,
        options: this.buildOptions(params),
      }),
    });
    if (!res.ok) {
      throw new Error(`Ollama error ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as { message?: { content?: string } };
    return data.message?.content || "";
  }

  async *streamMessage(params: SendMessageParams): AsyncGenerator<StreamChunk> {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        model: params.model || "llama3",
        messages: this.buildMessages(params),
        stream: true,
        options: this.buildOptions(params),
      }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`Ollama error ${res.status}: ${await res.text()}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const emit = function* (line: string): Generator<StreamChunk> {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const obj = JSON.parse(trimmed) as {
          message?: { content?: string };
          done?: boolean;
        };
        if (obj.message?.content) {
          yield { type: "text", content: obj.message.content };
        }
      } catch {
        // Ignore malformed partial lines.
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        yield* emit(line);
      }
    }
    // Flush any trailing JSON object that arrived without a closing newline,
    // so the final tokens of the response are never dropped.
    if (buffer.trim()) {
      yield* emit(buffer);
    }
    yield { type: "done", content: "" };
  }

  async validateCredentials(_apiKey: string): Promise<boolean> {
    try {
      const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { cache: "no-store" });
      return res.ok;
    } catch {
      return false;
    }
  }
}
