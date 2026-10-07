import type { ProviderName } from "./types";
import { getProvider } from "./catalog";
import { estimateTokens } from "@/lib/prompt-engine/prompt-linter";

function isLocalProvider(provider: ProviderName): boolean {
  return provider === "ollama" || !!getProvider(provider)?.local;
}

// USD price per 1,000,000 tokens. Approximate public list prices; adjust as needed.
interface Price {
  input: number;
  output: number;
  // Long-prompt tier: applies to the whole request once the prompt exceeds `tokens`.
  above?: { tokens: number; input: number; output: number };
}

// USD per 1M tokens. Keep current model ids; unknown/newer ids use the
// per-provider fallback below. Lookups use the LONGEST matching prefix, so
// "claude-opus-5-5" never falls back to "claude-opus-5" and dated/variant ids
// (e.g. "claude-haiku-4-5-20251001") resolve to their base entry.
const MODEL_PRICING: Record<string, Price> = {
  // Claude — current
  "claude-fable-5-1": { input: 10, output: 50 },
  "claude-mythos-5-1": { input: 10, output: 50 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, above: { tokens: 100_000, input: 0.5, output: 2.5 } },
  // Claude — previous generations
  "claude-fable-5": { input: 10, output: 50 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  // Gemini
  "gemini-3-pro": { input: 2, output: 12, above: { tokens: 200_000, input: 4, output: 18 } },
  "gemini-3-flash": { input: 0.5, output: 3 },
  "gemini-2.5-pro": { input: 1.25, output: 10, above: { tokens: 200_000, input: 2.5, output: 15 } },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
};

function priceFor(provider: ProviderName, model: string): Price {
  if (isLocalProvider(provider)) return { input: 0, output: 0 }; // local = free
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  // Longest-prefix match for dated/variant ids.
  let best = "";
  for (const key of Object.keys(MODEL_PRICING)) {
    if (key.length > best.length && model.startsWith(key)) best = key;
  }
  if (best) return MODEL_PRICING[best];
  // Reasonable per-provider fallbacks for unknown/newer model ids.
  if (provider === "claude") return { input: 5, output: 25 };
  if (provider === "gemini") return { input: 0.3, output: 2.5 };
  return { input: 0, output: 0 };
}

export interface CostEstimate {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  isLocal: boolean;
}

/** Estimates token usage and USD cost for a single run from the raw input/output text. */
export function estimateCost(
  provider: ProviderName,
  model: string,
  inputText: string,
  outputText: string
): CostEstimate {
  const inputTokens = estimateTokens(inputText);
  const outputTokens = estimateTokens(outputText);
  const base = priceFor(provider, model);
  const p = base.above && inputTokens > base.above.tokens ? base.above : base;
  const costUsd =
    (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
  return { inputTokens, outputTokens, costUsd, isLocal: isLocalProvider(provider) };
}

export function formatCost(costUsd: number, isLocal: boolean): string {
  if (isLocal) return "lokal · $0";
  if (costUsd < 0.01) return `$${costUsd.toFixed(4)}`;
  return `$${costUsd.toFixed(3)}`;
}
