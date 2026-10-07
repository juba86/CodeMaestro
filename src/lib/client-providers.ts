// Browser-only: API keys and base URLs live in this device's localStorage.
// Never call this on the server.

import { getApiKey, getBaseUrl } from "@/lib/ai/client-keys";
import { PROVIDERS as CHAT_PROVIDERS } from "@/lib/ai/catalog";

// Collect the user's configured cloud/custom OpenAI-compatible providers so the
// orchestrator can offer them as optional text workers (keys live in the
// browser). Cloud needs a key; the custom endpoint needs a base URL.
export async function gatherClientProviders(): Promise<{ id: string; key: string; baseUrl: string }[]> {
  const out: { id: string; key: string; baseUrl: string }[] = [];
  for (const def of CHAT_PROVIDERS) {
    if (def.kind !== "openai" && def.kind !== "openai-local") continue;
    const key = await getApiKey(def.id);
    const baseUrl = getBaseUrl(def.id);
    if (def.kind === "openai") { if (!key) continue; } // cloud: needs key
    else if (def.configurableBaseUrl) { if (!baseUrl) continue; } // custom: needs base
    else continue; // lmstudio etc.: skip auto-include to avoid inert workers
    out.push({ id: def.id, key, baseUrl });
  }
  return out;
}
