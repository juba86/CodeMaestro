import type { ModelInfo } from "./types";

// How a provider is talked to. Drives instantiation and model discovery.
export type ProviderKind =
  | "anthropic" // dedicated Anthropic SDK provider (+ optional CLI login)
  | "gemini" // dedicated Google GenAI provider (+ optional CLI login)
  | "ollama" // local Ollama daemon (native /api)
  | "openai" // remote OpenAI-compatible HTTP API (key required)
  | "openai-local"; // local OpenAI-compatible server (LM Studio, custom; key optional)

export interface ProviderDef {
  id: string; // stable key used in URLs, localStorage, settings
  label: string; // display name
  kind: ProviderKind;
  baseUrl?: string; // for openai/openai-local: REST base ending before /chat/completions
  envKeys?: string[]; // server-side env var fallbacks for the key
  local?: boolean; // local server — no key required, discovered at runtime
  keyOptional?: boolean; // a key may be set but isn't required
  configurableBaseUrl?: boolean; // user supplies the base URL (custom endpoint)
  supportsOAuth?: boolean; // can run via a locally logged-in CLI instead of a key
  noModelsEndpoint?: boolean; // provider has no GET /models — rely on staticModels
  docs?: string; // where to get a key
  staticModels?: { id: string; name: string }[]; // fallback when discovery is unavailable
}

// Single source of truth for every chat/text provider the app supports.
export const PROVIDERS: ProviderDef[] = [
  {
    id: "claude",
    label: "Claude (Anthropic)",
    kind: "anthropic",
    envKeys: ["ANTHROPIC_API_KEY"],
    supportsOAuth: true,
    docs: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "gemini",
    label: "Gemini (Google)",
    kind: "gemini",
    envKeys: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
    supportsOAuth: true,
    docs: "https://aistudio.google.com/apikey",
  },
  {
    id: "openai",
    label: "OpenAI",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    envKeys: ["OPENAI_API_KEY"],
    docs: "https://platform.openai.com/api-keys",
    // gpt-4o stays first: the orchestrator uses staticModels[0] as its default
    // worker, and streaming GPT-5 requires a verified OpenAI organization.
    staticModels: [
      { id: "gpt-4o", name: "GPT-4o" },
      { id: "gpt-4o-mini", name: "GPT-4o mini" },
      { id: "gpt-5", name: "GPT-5" },
      { id: "gpt-5-mini", name: "GPT-5 mini" },
      { id: "o4-mini", name: "o4-mini" },
    ],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    kind: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    envKeys: ["OPENROUTER_API_KEY"],
    docs: "https://openrouter.ai/keys",
  },
  {
    id: "groq",
    label: "Groq",
    kind: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    envKeys: ["GROQ_API_KEY"],
    docs: "https://console.groq.com/keys",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    kind: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    envKeys: ["DEEPSEEK_API_KEY"],
    docs: "https://platform.deepseek.com/api_keys",
    staticModels: [
      { id: "deepseek-chat", name: "DeepSeek V3 (chat)" },
      { id: "deepseek-reasoner", name: "DeepSeek R1 (reasoner)" },
    ],
  },
  {
    id: "mistral",
    label: "Mistral",
    kind: "openai",
    baseUrl: "https://api.mistral.ai/v1",
    envKeys: ["MISTRAL_API_KEY"],
    docs: "https://console.mistral.ai/api-keys",
  },
  {
    id: "xai",
    label: "xAI (Grok)",
    kind: "openai",
    baseUrl: "https://api.x.ai/v1",
    envKeys: ["XAI_API_KEY"],
    docs: "https://console.x.ai",
    staticModels: [
      { id: "grok-2-latest", name: "Grok 2" },
      { id: "grok-beta", name: "Grok Beta" },
    ],
  },
  {
    id: "together",
    label: "Together AI",
    kind: "openai",
    baseUrl: "https://api.together.xyz/v1",
    envKeys: ["TOGETHER_API_KEY"],
    docs: "https://api.together.ai/settings/api-keys",
  },
  {
    id: "perplexity",
    label: "Perplexity",
    kind: "openai",
    baseUrl: "https://api.perplexity.ai",
    envKeys: ["PERPLEXITY_API_KEY"],
    noModelsEndpoint: true,
    docs: "https://www.perplexity.ai/settings/api",
    staticModels: [
      { id: "sonar", name: "Sonar" },
      { id: "sonar-pro", name: "Sonar Pro" },
      { id: "sonar-reasoning", name: "Sonar Reasoning" },
      { id: "sonar-reasoning-pro", name: "Sonar Reasoning Pro" },
    ],
  },
  {
    id: "ollama",
    label: "Ollama (lokal)",
    kind: "ollama",
    local: true,
  },
  {
    // Ollama's hosted cloud — OpenAI-compatible API at ollama.com with a key.
    // Cloud models use a "-cloud" suffix; the live /models list (when a key is
    // set) supersedes the static fallback below. Models can also be typed in.
    id: "ollama-cloud",
    label: "Ollama Cloud",
    kind: "openai",
    baseUrl: "https://ollama.com/v1",
    envKeys: ["OLLAMA_API_KEY"],
    docs: "https://ollama.com/settings/keys",
    staticModels: [
      { id: "gpt-oss:20b-cloud", name: "gpt-oss 20B (cloud)" },
      { id: "gpt-oss:120b-cloud", name: "gpt-oss 120B (cloud)" },
      { id: "qwen3-coder:480b-cloud", name: "Qwen3 Coder 480B (cloud)" },
      { id: "deepseek-v3.1:671b-cloud", name: "DeepSeek V3.1 671B (cloud)" },
      { id: "kimi-k2:1t-cloud", name: "Kimi K2 1T (cloud)" },
    ],
  },
  {
    id: "lmstudio",
    label: "LM Studio (lokal)",
    kind: "openai-local",
    baseUrl: "http://localhost:1234/v1",
    local: true,
    keyOptional: true,
  },
  {
    id: "custom",
    label: "Custom (OpenAI-kompatibel)",
    kind: "openai-local",
    configurableBaseUrl: true,
    keyOptional: true,
    docs: "Jan, llama.cpp, vLLM, LocalAI, Azure OpenAI …",
  },
];

const byId = new Map(PROVIDERS.map((p) => [p.id, p]));

export function getProvider(id: string): ProviderDef | undefined {
  return byId.get(id);
}

export function isKnownProvider(id: string): boolean {
  return byId.has(id);
}

/**
 * Resolve a provider's server-side env key fallback, if any is set.
 * Never returned for configurableBaseUrl providers: their host comes from the
 * caller, and a server key must only ever travel to the catalog's own host.
 */
export function envKeyFor(def: ProviderDef): string {
  if (def.configurableBaseUrl) return "";
  for (const k of def.envKeys || []) {
    const v = process.env[k];
    if (v) return v;
  }
  return "";
}

/**
 * The base URL a request may use for this provider. Only configurableBaseUrl
 * providers honour a caller-supplied URL (http/https only); every other provider
 * is pinned to its catalog URL so a client can't redirect it (and its key) elsewhere.
 */
export function resolveBaseUrl(def: ProviderDef, clientBase?: string | null): string | undefined {
  if (!def.configurableBaseUrl) return def.baseUrl;
  const raw = (clientBase || "").trim();
  if (!raw) return undefined;
  try {
    const { protocol } = new URL(raw);
    return protocol === "http:" || protocol === "https:" ? raw : undefined;
  } catch {
    return undefined;
  }
}

/** A provider needs an API key unless it's local or explicitly key-optional. */
export function requiresKey(def: ProviderDef): boolean {
  return !def.local && !def.keyOptional && def.kind !== "ollama";
}

export function staticModelInfos(def: ProviderDef): ModelInfo[] {
  return (def.staticModels || []).map((m) => ({
    id: m.id,
    name: m.name,
    provider: def.id,
    maxTokens: 8192,
  }));
}
