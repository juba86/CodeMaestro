import type { AIProvider, ModelInfo, ProviderName } from "./types";
import { ClaudeProvider } from "./claude-provider";
import { GeminiProvider } from "./gemini-provider";

const providers: Record<ProviderName, new (apiKey: string) => AIProvider> = {
  claude: ClaudeProvider,
  gemini: GeminiProvider,
};

const staticModels: Record<ProviderName, ModelInfo[]> = {
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

export function createProvider(name: ProviderName, apiKey: string): AIProvider {
  const Provider = providers[name];
  if (!Provider) throw new Error(`Unknown provider: ${name}`);
  return new Provider(apiKey);
}

export function getProviderNames(): ProviderName[] {
  return Object.keys(providers) as ProviderName[];
}
