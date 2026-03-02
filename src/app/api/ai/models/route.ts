import { NextRequest, NextResponse } from "next/server";
import { getStaticModels, getProviderNames } from "@/lib/ai/provider-factory";
import type { ProviderName } from "@/lib/ai/types";

const validProviders = new Set<string>(["claude", "gemini"]);

export async function GET(req: NextRequest) {
  const providerName = req.nextUrl.searchParams.get("provider");

  if (!providerName) {
    // Return all models
    const all = getProviderNames().flatMap((name) => getStaticModels(name));
    return NextResponse.json({ models: all });
  }

  if (!validProviders.has(providerName)) {
    return NextResponse.json(
      { error: `Unknown provider: ${providerName}`, code: "INVALID_PROVIDER" },
      { status: 400 }
    );
  }

  return NextResponse.json({ models: getStaticModels(providerName as ProviderName) });
}
