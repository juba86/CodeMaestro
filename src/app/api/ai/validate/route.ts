import { NextRequest, NextResponse } from "next/server";
import { createProvider } from "@/lib/ai/provider-factory";
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

    const { provider: providerName, apiKey } = result.data;
    const provider = createProvider(providerName, apiKey);
    const valid = await provider.validateCredentials(apiKey);

    return NextResponse.json({ valid });
  } catch {
    return NextResponse.json({ valid: false });
  }
}
