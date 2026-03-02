import { NextRequest, NextResponse } from "next/server";
import { getStaticModels, getProviderNames } from "@/lib/ai/provider-factory";
import type { ProviderName } from "@/lib/ai/types";

export async function GET(req: NextRequest) {
  const providerName = req.nextUrl.searchParams.get("provider") as ProviderName | null;

  if (!providerName) {
    // Return all models
    const all = getProviderNames().flatMap((name) => getStaticModels(name));
    return NextResponse.json({ models: all });
  }

  return NextResponse.json({ models: getStaticModels(providerName) });
}
