import { NextRequest, NextResponse } from "next/server";
import { createProvider } from "@/lib/ai/provider-factory";
import type { ProviderName } from "@/lib/ai/types";

export async function POST(req: NextRequest) {
  try {
    const { provider: providerName, apiKey } = (await req.json()) as {
      provider: ProviderName;
      apiKey: string;
    };

    const provider = createProvider(providerName, apiKey);
    const valid = await provider.validateCredentials(apiKey);

    return NextResponse.json({ valid });
  } catch {
    return NextResponse.json({ valid: false });
  }
}
