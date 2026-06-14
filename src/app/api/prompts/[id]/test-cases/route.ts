import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { createTestCaseSchema, formatZodError } from "@/lib/validation/schemas";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const testCases = await prisma.testCase.findMany({
    where: { promptId: id },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ testCases });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const prompt = await prisma.prompt.findUnique({ where: { id } });
    if (!prompt) {
      return NextResponse.json({ error: "Prompt not found", code: "NOT_FOUND" }, { status: 404 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body", code: "INVALID_JSON" }, { status: 400 });
    }

    const parsed = createTestCaseSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: formatZodError(parsed.error), code: "VALIDATION_ERROR" },
        { status: 400 }
      );
    }

    const testCase = await prisma.testCase.create({
      data: { promptId: id, ...parsed.data },
    });
    return NextResponse.json({ testCase }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/prompts/[id]/test-cases]", err);
    return NextResponse.json({ error: "Internal server error", code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
