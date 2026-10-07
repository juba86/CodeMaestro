import type { ModelInfo, ProviderName } from "./types";
import { getProvider, staticModelInfos } from "./catalog";

// Fallback lists used only when the live Models API is unreachable / no key set.
// The provider routes fetch the real, current list dynamically (see provider-factory).
const legacyStatic: Record<string, ModelInfo[]> = {
  claude: [
    { id: "claude-opus-5-5", name: "Claude Opus 5.5", provider: "claude", maxTokens: 128000 },
    { id: "claude-fable-5-1", name: "Claude Fable 5.1", provider: "claude", maxTokens: 128000 },
    { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", provider: "claude", maxTokens: 128000 },
    { id: "claude-haiku-5-5", name: "Claude Haiku 5.5", provider: "claude", maxTokens: 128000 },
    // Older ids kept for users who pinned them.
    { id: "claude-opus-5", name: "Claude Opus 5", provider: "claude", maxTokens: 128000 },
    { id: "claude-opus-4-8", name: "Claude Opus 4.8", provider: "claude", maxTokens: 128000 },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "claude", maxTokens: 128000 },
    { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", provider: "claude", maxTokens: 64000 },
  ],
  gemini: [
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", provider: "gemini", maxTokens: 65536 },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "gemini", maxTokens: 65536 },
    { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite", provider: "gemini", maxTokens: 65536 },
  ],
  // Ollama models are discovered dynamically from the local daemon at runtime.
  ollama: [],
};

export function getStaticModels(name: ProviderName): ModelInfo[] {
  if (legacyStatic[name]) return legacyStatic[name];
  const def = getProvider(name);
  return def ? staticModelInfos(def) : [];
}
