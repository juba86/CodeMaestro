import type { ModelInfo, ProviderName } from "./types";

export const staticModels: Record<ProviderName, ModelInfo[]> = {
  claude: [
    { id: "claude-opus-4-20250514", name: "Claude Opus 4", provider: "claude", maxTokens: 32000 },
    { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", provider: "claude", maxTokens: 16000 },
    { id: "claude-haiku-4-20250414", name: "Claude Haiku 4", provider: "claude", maxTokens: 8192 },
  ],
  gemini: [
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", provider: "gemini", maxTokens: 65536 },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "gemini", maxTokens: 65536 },
    { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", provider: "gemini", maxTokens: 8192 },
  ],
};

export function getStaticModels(name: ProviderName): ModelInfo[] {
  return staticModels[name] || [];
}
