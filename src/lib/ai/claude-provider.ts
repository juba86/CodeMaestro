import Anthropic from "@anthropic-ai/sdk";
import type { AIProvider, SendMessageParams, StreamChunk, ModelInfo } from "./types";
import { getStaticModels } from "./models";

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
      model: params.model || "claude-sonnet-4-20250514",
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
      model: params.model || "claude-sonnet-4-20250514",
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
        model: "claude-haiku-4-20250414",
        max_tokens: 10,
        messages: [{ role: "user", content: "hi" }],
      });
      return true;
    } catch {
      return false;
    }
  }
}
