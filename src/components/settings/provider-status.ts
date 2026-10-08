// Which chat providers count as "eingerichtet" (Settings → Provider, the
// settings nav hint and the home status strip). Pure, unit-tested.

import { PROVIDERS, type ProviderDef } from "@/lib/ai/catalog";

// Display ordering: dedicated + cloud first, local/custom last.
const ORDER = ["claude", "gemini", "openai", "openrouter", "groq", "deepseek", "mistral", "xai", "together", "perplexity", "ollama-cloud", "ollama", "lmstudio", "custom"];

const rank = (id: string) => {
  const i = ORDER.indexOf(id);
  return i === -1 ? ORDER.length : i;
};

/** Every chat provider in display order. */
export const PROVIDER_LIST: ProviderDef[] = [...PROVIDERS].sort((a, b) => rank(a.id) - rank(b.id));

export type AuthMode = "key" | "oauth";

/** Claude and Gemini can run through a logged-in CLI on the server instead of a key. */
export function supportsLogin(def: ProviderDef): boolean {
  return Boolean(def.supportsOAuth) && (def.id === "claude" || def.id === "gemini");
}

export function isOllama(def: ProviderDef): boolean {
  return def.kind === "ollama";
}

/** Ollama talks to the local daemon and has no key field. */
export function showKeyField(def: ProviderDef): boolean {
  return !isOllama(def);
}

export function keyRequired(def: ProviderDef): boolean {
  return !def.local && !def.keyOptional && !isOllama(def);
}

export interface ProviderSetupState {
  /** An API key is stored in this browser. */
  hasKey: boolean;
  /** Stored base URL (custom OpenAI-compatible endpoint). */
  baseUrl?: string;
  /** claude / gemini: "oauth" = CLI login on the server. */
  authMode?: AuthMode;
  /** The provider is the active one (Standardmodell). */
  active?: boolean;
}

/**
 * Set up = it has what it needs to answer: a CLI login, a stored key, or a
 * base URL for a custom endpoint. Local servers need no credentials and
 * count once they are in use (the active provider).
 */
export function isProviderConfigured(def: ProviderDef, s: ProviderSetupState): boolean {
  if (supportsLogin(def) && s.authMode === "oauth") return true;
  if (s.hasKey) return true;
  if (def.configurableBaseUrl) return Boolean(s.baseUrl?.trim());
  if (def.local || isOllama(def)) return Boolean(s.active);
  return false;
}

export interface ProviderSetupSummary {
  configured: number;
  total: number;
  /** Ids of the configured providers, in display order. */
  ids: string[];
}

export function summarizeProviders(
  list: ProviderDef[],
  stateOf: (def: ProviderDef) => ProviderSetupState,
): ProviderSetupSummary {
  const ids = list.filter((def) => isProviderConfigured(def, stateOf(def))).map((def) => def.id);
  return { configured: ids.length, total: list.length, ids };
}

/** "4 von 14 eingerichtet". */
export function providerSummaryText(s: Pick<ProviderSetupSummary, "configured" | "total">): string {
  return `${s.configured} von ${s.total} eingerichtet`;
}
