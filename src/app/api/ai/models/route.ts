import { NextRequest, NextResponse } from "next/server";
import { getStaticModels } from "@/lib/ai/provider-factory";
import { fetchOllamaModels } from "@/lib/ai/ollama-provider";
import { fetchClaudeModels } from "@/lib/ai/claude-provider";
import { fetchGeminiModels } from "@/lib/ai/gemini-provider";
import { geminiCliModels } from "@/lib/ai/gemini-cli-provider";
import { claudeCliModels } from "@/lib/ai/claude-cli-provider";
import { fetchOpenAICompatModels } from "@/lib/ai/openai-compatible-provider";
import { getProvider, envKeyFor, resolveBaseUrl, staticModelInfos, PROVIDERS } from "@/lib/ai/catalog";
import { getSetting } from "@/lib/settings";
import type { ModelInfo } from "@/lib/ai/types";

// Resolve a provider's live model list, falling back to the static list if the
// API is unreachable or no key is available. The client passes its stored key via
// the x-provider-key header (Tailscale-private; the key is the user's own); the
// custom endpoint's base URL comes via x-provider-base.
async function liveModels(
  provider: string,
  headerKey: string,
  headerBase: string
): Promise<ModelInfo[]> {
  const def = getProvider(provider);
  if (!def) return [];

  switch (def.kind) {
    case "ollama":
      return fetchOllamaModels();

    case "anthropic": {
      if ((await getSetting("claudeAuthMode", "key")) === "oauth") return claudeCliModels();
      const key = headerKey || envKeyFor(def);
      const live = key ? await fetchClaudeModels(key) : [];
      return live.length ? live : getStaticModels("claude");
    }

    case "gemini": {
      if ((await getSetting("geminiAuthMode", "key")) === "oauth") return geminiCliModels();
      const key = headerKey || envKeyFor(def);
      const live = key ? await fetchGeminiModels(key) : [];
      return live.length ? live : getStaticModels("gemini");
    }

    case "openai":
    case "openai-local": {
      // Client base URL only for configurableBaseUrl providers; envKeyFor() never
      // pairs a server key with such a caller-chosen host.
      const baseUrl = resolveBaseUrl(def, headerBase);
      if (!baseUrl) return staticModelInfos(def);
      const key = headerKey || envKeyFor(def);
      const live = def.noModelsEndpoint ? [] : await fetchOpenAICompatModels(def.id, baseUrl, key);
      return live.length ? live : staticModelInfos(def);
    }

    default:
      return [];
  }
}

export async function GET(req: NextRequest) {
  const providerName = req.nextUrl.searchParams.get("provider");
  const headerKey = req.headers.get("x-provider-key") || "";
  const headerBase = req.headers.get("x-provider-base") || "";

  if (!providerName) {
    // All providers — used by the playground's compare mode. Static cloud lists
    // (no per-provider key here) plus live local Ollama models.
    const cloud = PROVIDERS.filter((p) => !p.local && p.kind !== "ollama").flatMap((p) =>
      getStaticModels(p.id)
    );
    const ollama = await fetchOllamaModels();
    return NextResponse.json({ models: [...cloud, ...ollama] });
  }

  if (!getProvider(providerName)) {
    return NextResponse.json(
      { error: `Unknown provider: ${providerName}`, code: "INVALID_PROVIDER" },
      { status: 400 }
    );
  }

  return NextResponse.json({ models: await liveModels(providerName, headerKey, headerBase) });
}
