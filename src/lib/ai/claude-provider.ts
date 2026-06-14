import Anthropic from "@anthropic-ai/sdk";
import type { AIProvider, SendMessageParams, StreamChunk, ModelInfo } from "./types";
import { getStaticModels } from "./models";

const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-6";
const VALIDATE_CLAUDE_MODEL = "claude-haiku-4-5";

/**
 * Fetches the live list of Claude models the given key can access
 * (GET /v1/models). Returns [] on any failure so the caller can fall back.
 */
export async function fetchClaudeModels(apiKey: string): Promise<ModelInfo[]> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: { id: string; display_name?: string }[] };
    return (data.data || []).map((m) => ({
      id: m.id,
      name: m.display_name || m.id,
      provider: "claude" as const,
      maxTokens: 32000,
    }));
  } catch {
    return [];
  }
}

export class ClaudeProvider implements AIProvider {
  name = "claude" as const;
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  getModels(): ModelInfo[] {
    return getStaticModels("claude");
  }

  async sendMessage(params: SendMessageParams): Promise<string> {
    const messages = params.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    const response = await this.client.messages.create({
      model: params.model || DEFAULT_CLAUDE_MODEL,
      max_tokens: params.maxTokens || 4096,
      system: params.systemPrompt || undefined,
      messages,
    });

    const textBlock = response.content.find((b) => b.type === "text");
    return textBlock ? textBlock.text : "";
  }

  async *streamMessage(params: SendMessageParams): AsyncGenerator<StreamChunk> {
    const messages = params.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    const stream = this.client.messages.stream({
      model: params.model || DEFAULT_CLAUDE_MODEL,
      max_tokens: params.maxTokens || 4096,
      system: params.systemPrompt || undefined,
      messages,
    });

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield { type: "text", content: event.delta.text };
      }
    }
    yield { type: "done", content: "" };
  }

  async validateCredentials(apiKey: string): Promise<boolean> {
    try {
      const client = new Anthropic({ apiKey });
      await client.messages.create({
        model: VALIDATE_CLAUDE_MODEL,
        max_tokens: 10,
        messages: [{ role: "user", content: "hi" }],
      });
      return true;
    } catch {
      return false;
    }
  }
}
