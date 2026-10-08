import type { AIProvider, ProviderName } from "./types";
import { ClaudeProvider } from "./claude-provider";
import { GeminiProvider } from "./gemini-provider";
import { OllamaProvider } from "./ollama-provider";
import { OpenAICompatibleProvider } from "./openai-compatible-provider";
import { getProvider, PROVIDERS, resolveBaseUrl } from "./catalog";

// Re-export from models.ts for backwards compatibility
export { getStaticModels } from "./models";

export interface CreateProviderOpts {
  baseUrl?: string; // required for the "custom" provider; ignored for fixed-host providers
}

export function createProvider(
  name: ProviderName,
  apiKey: string,
  opts: CreateProviderOpts = {}
): AIProvider {
  const def = getProvider(name);
  if (!def) throw new Error(`Unknown provider: ${name}`);

  switch (def.kind) {
    case "anthropic":
      return new ClaudeProvider(apiKey);
    case "gemini":
      return new GeminiProvider(apiKey);
    case "ollama":
      return new OllamaProvider(); // no API key needed
    case "openai":
    case "openai-local": {
      // Only configurableBaseUrl providers may be pointed elsewhere (see resolveBaseUrl).
      const baseUrl = resolveBaseUrl(def, opts.baseUrl);
      if (!baseUrl) throw new Error(`Provider ${name} requires a valid http(s) base URL`);
      return new OpenAICompatibleProvider({
        providerId: def.id,
        baseUrl,
        apiKey,
        noModelsEndpoint: def.noModelsEndpoint,
      });
    }
    default:
      throw new Error(`Unsupported provider kind for ${name}`);
  }
}

export function getProviderNames(): ProviderName[] {
  return PROVIDERS.map((p) => p.id);
}
