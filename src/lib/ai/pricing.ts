import type { ProviderName } from "./types";
import { estimateTokens } from "@/lib/prompt-engine/prompt-linter";

// USD price per 1,000,000 tokens. Approximate public list prices; adjust as needed.
interface Price {
  input: number;
  output: number;
}

// USD per 1M tokens. Keep current model ids; unknown/newer ids use the
// per-provider fallback below (and prefix matches handle dated variants).
const MODEL_PRICING: Record<string, Price> = {
  // Claude
  "claude-fable-5": { input: 10, output: 50 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  // Gemini
  "gemini-2.5-pro": { input: 1.25, output: 10 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
};

function priceFor(provider: ProviderName, model: string): Price {
  if (provider === "ollama") return { input: 0, output: 0 }; // local = free
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  // Prefix match for dated/variant ids (e.g. "claude-opus-4-8-...").
  const prefix = Object.keys(MODEL_PRICING).find((k) => model.startsWith(k));
  if (prefix) return MODEL_PRICING[prefix];
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
  const p = priceFor(provider, model);
  const costUsd =
    (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
  return { inputTokens, outputTokens, costUsd, isLocal: provider === "ollama" };
}

export function formatCost(costUsd: number, isLocal: boolean): string {
  if (isLocal) return "lokal · $0";
  if (costUsd < 0.01) return `$${costUsd.toFixed(4)}`;
  return `$${costUsd.toFixed(3)}`;
}
