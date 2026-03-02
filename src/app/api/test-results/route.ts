import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { createTestResultSchema, formatZodError } from "@/lib/validation/schemas";

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

    const parsed = createTestResultSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: formatZodError(parsed.error), code: "VALIDATION_ERROR" },
        { status: 400 }
      );
    }

    const { promptId, provider, model, input, output, latencyMs } = parsed.data;

    // Verify prompt exists
    const prompt = await prisma.prompt.findUnique({ where: { id: promptId } });
    if (!prompt) {
      return NextResponse.json(
        { error: "Prompt not found", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    const result = await prisma.testResult.create({
      data: { promptId, provider, model, input, output, latencyMs },
    });

    return NextResponse.json({ result }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/test-results]", err);
    return NextResponse.json(
      { error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
