import { GoogleGenAI } from "@google/genai";
import type { AIProvider, SendMessageParams, StreamChunk, ModelInfo } from "./types";
import { getStaticModels } from "./models";

interface GeminiApiModel {
  name: string;
  displayName?: string;
  supportedGenerationMethods?: string[];
  outputTokenLimit?: number;
}

/**
 * Fetches the live list of Gemini models the given key can access
 * (GET /v1beta/models). Filters to chat-capable models (generateContent),
 * excluding embedding / legacy variants. Returns [] on failure for fallback.
 */
export async function fetchGeminiModels(apiKey: string): Promise<ModelInfo[]> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(apiKey)}`,
      { cache: "no-store" }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: GeminiApiModel[] };
    return (data.models || [])
      // Keep chat models. Only exclude when the methods list is present AND lacks
      // generateContent — if the field is absent we keep the model rather than
      // dropping everything.
      .filter((m) => {
        const methods = m.supportedGenerationMethods;
        if (methods && methods.length > 0 && !methods.includes("generateContent")) return false;
        return true;
      })
      .filter((m) => !/embedding|aqa/i.test(m.name))
      .map((m) => {
        const id = m.name.replace(/^models\//, "");
        return {
          id,
          name: m.displayName || id,
          provider: "gemini" as const,
          maxTokens: m.outputTokenLimit || 8192,
        };
      })
      .sort((a, b) => b.id.localeCompare(a.id)); // newer ids (gemini-3 before 2.5) first
  } catch {
    return [];
  }
}

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
    // Validate against the models-list endpoint rather than a specific model,
    // so a valid key isn't rejected just because one hardcoded model is
    // unavailable to the key/project.
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(apiKey)}`,
        { cache: "no-store" }
      );
      return res.ok;
    } catch {
      return false;
    }
  }
}
