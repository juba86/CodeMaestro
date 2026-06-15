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

/** Reads the stored base URL for a configurable (custom) OpenAI-compatible endpoint. */
export function getBaseUrl(provider: ProviderName): string {
  try {
    return localStorage.getItem(`pb-baseurl-${provider}`) || "";
  } catch {
    return "";
  }
}

/**
 * Fetches the model list for a provider, forwarding the stored key (and, for the
 * custom endpoint, the base URL) so the server can return the live model list.
 */
export async function fetchModelsForProvider(
  provider: ProviderName,
  signal?: AbortSignal,
  explicitKey?: string,
  explicitBase?: string
): Promise<ModelInfo[]> {
  // Prefer an explicitly-provided value (e.g. the field being typed in Settings,
  // before it's saved), otherwise fall back to the stored value.
  const key = (explicitKey && explicitKey.trim()) || (await getApiKey(provider));
  const base = (explicitBase && explicitBase.trim()) || getBaseUrl(provider);
  const headers: Record<string, string> = {};
  if (key) headers["x-provider-key"] = key;
  if (base) headers["x-provider-base"] = base;
  const res = await fetch(`/api/ai/models?provider=${provider}`, {
    headers: Object.keys(headers).length ? headers : undefined,
    signal,
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.models || []) as ModelInfo[];
}
