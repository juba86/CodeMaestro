import { NextRequest, NextResponse } from "next/server";
import { createProvider } from "@/lib/ai/provider-factory";
import { GeminiCliProvider } from "@/lib/ai/gemini-cli-provider";
import { ClaudeCliProvider } from "@/lib/ai/claude-cli-provider";
import { getProvider, resolveBaseUrl } from "@/lib/ai/catalog";
import { validateRequestSchema, formatZodError } from "@/lib/validation/schemas";

export async function POST(req: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body", code: "INVALID_JSON" },
        { status: 400 }
      );
    }

    const result = validateRequestSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: formatZodError(result.error), code: "VALIDATION_ERROR" },
        { status: 400 }
      );
    }

    const { provider: providerName, apiKey, authMode, baseUrl } = result.data;
    const def = getProvider(providerName);
    if (!def) return NextResponse.json({ valid: false });
    // Only the caller's own key is validated (no env fallback here), and a
    // client base URL is honoured only for configurableBaseUrl providers.
    const provider =
      authMode === "oauth" && providerName === "gemini"
        ? new GeminiCliProvider()
        : authMode === "oauth" && providerName === "claude"
          ? new ClaudeCliProvider()
          : createProvider(providerName, apiKey, { baseUrl: resolveBaseUrl(def, baseUrl) });
    const valid = await provider.validateCredentials(apiKey);

    return NextResponse.json({ valid });
  } catch {
    return NextResponse.json({ valid: false });
  }
}
