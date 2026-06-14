import type { ModelInfo, ProviderName } from "./types";

export const staticModels: Record<ProviderName, ModelInfo[]> = {
  // Fallback list used only when the live Models API is unreachable / no key set.
  // The provider routes fetch the real, current list dynamically (see provider-factory).
  claude: [
    { id: "claude-opus-4-8", name: "Claude Opus 4.8", provider: "claude", maxTokens: 32000 },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "claude", maxTokens: 32000 },
    { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", provider: "claude", maxTokens: 16000 },
  ],
  gemini: [
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", provider: "gemini", maxTokens: 65536 },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "gemini", maxTokens: 65536 },
    { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite", provider: "gemini", maxTokens: 65536 },
  ],
  // Ollama models are discovered dynamically from the local daemon at runtime
  // (see fetchOllamaModels in ollama-provider.ts), so there is no static list.
  ollama: [],
};

export function getStaticModels(name: ProviderName): ModelInfo[] {
  return staticModels[name] || [];
}
