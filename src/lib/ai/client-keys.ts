import { decryptApiKey } from "./crypto";
import type { ProviderName, ModelInfo } from "./types";

/**
 * Reads and decrypts the stored API key for a provider from localStorage.
 * Local providers (e.g. Ollama) need no key and return "".
 * Centralised here so every caller (builder, playground, refinement) stays in sync.
 */
export async function getApiKey(provider: ProviderName): Promise<string> {
  if (provider === "ollama") return "";
  const enc = localStorage.getItem(`pb-apikey-${provider}`);
  if (enc) {
    try {
      return await decryptApiKey(enc);
    } catch {
      /* corrupt/old value — fall through to empty */
    }
  }
  return "";
}

/**
 * Fetches the model list for a provider, forwarding the stored key so the server
 * can return the live, current models (Claude/Gemini Models API; Ollama is local).
 */
export async function fetchModelsForProvider(
  provider: ProviderName,
  signal?: AbortSignal,
  explicitKey?: string
): Promise<ModelInfo[]> {
  // Prefer an explicitly-provided key (e.g. the value being typed in Settings,
  // before it's saved), otherwise fall back to the stored key.
  const key = (explicitKey && explicitKey.trim()) || (await getApiKey(provider));
  const res = await fetch(`/api/ai/models?provider=${provider}`, {
    headers: key ? { "x-provider-key": key } : undefined,
    signal,
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.models || []) as ModelInfo[];
}
