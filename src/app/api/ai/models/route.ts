import { NextRequest, NextResponse } from "next/server";
import { getStaticModels } from "@/lib/ai/provider-factory";
import { fetchOllamaModels } from "@/lib/ai/ollama-provider";
import { fetchClaudeModels } from "@/lib/ai/claude-provider";
import { fetchGeminiModels } from "@/lib/ai/gemini-provider";
import { geminiCliModels } from "@/lib/ai/gemini-cli-provider";
import { claudeCliModels } from "@/lib/ai/claude-cli-provider";
import { getSetting } from "@/lib/settings";
import type { ModelInfo } from "@/lib/ai/types";

const validProviders = new Set<string>(["claude", "gemini", "ollama"]);

// Resolve the provider's live model list, falling back to the static list if the
// API is unreachable or no key is available. The client passes its stored key via
// the x-provider-key header (Tailscale-private; the key is the user's own).
async function liveModels(
  provider: string,
  headerKey: string
): Promise<ModelInfo[]> {
  if (provider === "ollama") return fetchOllamaModels();

  if (provider === "claude") {
    if ((await getSetting("claudeAuthMode", "key")) === "oauth") {
      return claudeCliModels();
    }
    const key = headerKey || process.env.ANTHROPIC_API_KEY || "";
    const live = key ? await fetchClaudeModels(key) : [];
    return live.length ? live : getStaticModels("claude");
  }

  if (provider === "gemini") {
    if ((await getSetting("geminiAuthMode", "key")) === "oauth") {
      return geminiCliModels();
    }
    const key = headerKey || process.env.GOOGLE_API_KEY || "";
    const live = key ? await fetchGeminiModels(key) : [];
    return live.length ? live : getStaticModels("gemini");
  }

  return [];
}

export async function GET(req: NextRequest) {
  const providerName = req.nextUrl.searchParams.get("provider");
  const headerKey = req.headers.get("x-provider-key") || "";

  if (!providerName) {
    // All providers — used by the playground's compare mode. Uses static cloud
    // lists (no per-provider key here) plus live local Ollama models.
    const claude = getStaticModels("claude");
    const gemini = getStaticModels("gemini");
    const ollama = await fetchOllamaModels();
    return NextResponse.json({ models: [...claude, ...gemini, ...ollama] });
  }

  if (!validProviders.has(providerName)) {
    return NextResponse.json(
      { error: `Unknown provider: ${providerName}`, code: "INVALID_PROVIDER" },
      { status: 400 }
    );
  }

  return NextResponse.json({ models: await liveModels(providerName, headerKey) });
}
