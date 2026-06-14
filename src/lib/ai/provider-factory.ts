import type { AIProvider, ProviderName } from "./types";
import { ClaudeProvider } from "./claude-provider";
import { GeminiProvider } from "./gemini-provider";
import { OllamaProvider } from "./ollama-provider";

// Re-export from models.ts for backwards compatibility
export { getStaticModels } from "./models";

const providers: Record<ProviderName, new (apiKey: string) => AIProvider> = {
  claude: ClaudeProvider,
  gemini: GeminiProvider,
  ollama: OllamaProvider,
};

export function createProvider(name: ProviderName, apiKey: string): AIProvider {
  const Provider = providers[name];
  if (!Provider) throw new Error(`Unknown provider: ${name}`);
  return new Provider(apiKey);
}

export function getProviderNames(): ProviderName[] {
  return Object.keys(providers) as ProviderName[];
}
