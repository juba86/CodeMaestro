import { GoogleGenAI } from "@google/genai";
import type { AIProvider, SendMessageParams, StreamChunk, ModelInfo } from "./types";
import { getStaticModels } from "./models";

export class GeminiProvider implements AIProvider {
  name = "gemini" as const;
  private client: GoogleGenAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  getModels(): ModelInfo[] {
    return getStaticModels("gemini");
  }

  async sendMessage(params: SendMessageParams): Promise<string> {
    const contents = params.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? ("model" as const) : ("user" as const),
        parts: [{ text: m.content }],
      }));

    const response = await this.client.models.generateContent({
      model: params.model || "gemini-2.5-flash",
      contents,
      config: {
        maxOutputTokens: params.maxTokens || 4096,
        temperature: params.temperature,
        systemInstruction: params.systemPrompt || undefined,
      },
    });

    return response.text || "";
  }

  async *streamMessage(params: SendMessageParams): AsyncGenerator<StreamChunk> {
    const contents = params.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? ("model" as const) : ("user" as const),
        parts: [{ text: m.content }],
      }));

    const response = await this.client.models.generateContentStream({
      model: params.model || "gemini-2.5-flash",
      contents,
      config: {
        maxOutputTokens: params.maxTokens || 4096,
        temperature: params.temperature,
        systemInstruction: params.systemPrompt || undefined,
      },
    });

    for await (const chunk of response) {
      if (chunk.text) {
        yield { type: "text", content: chunk.text };
      }
    }
    yield { type: "done", content: "" };
  }

  async validateCredentials(apiKey: string): Promise<boolean> {
    try {
      const client = new GoogleGenAI({ apiKey });
      // Fix: pass proper Contents array instead of bare string
      await client.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
      });
      return true;
    } catch {
      return false;
    }
  }
}
