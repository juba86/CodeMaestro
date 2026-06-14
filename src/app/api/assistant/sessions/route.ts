import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { createAssistantSessionSchema, formatZodError } from "@/lib/validation/schemas";
import { resolveWorkdir } from "@/lib/assistant/security";

export async function GET() {
  const sessions = await prisma.assistantSession.findMany({
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { messages: true } } },
  });
  return NextResponse.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      provider: s.provider,
      model: s.model,
      title: s.title || s.cwd,
      cwd: s.cwd,
      status: s.status,
      totalCostUsd: s.totalCostUsd,
      messageCount: s._count.messages,
      updatedAt: s.updatedAt,
    })),
  });
}

export async function POST(req: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body", code: "INVALID_JSON" }, { status: 400 });
    }

    const parsed = createAssistantSessionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error), code: "VALIDATION_ERROR" }, { status: 400 });
    }

    let cwd: string;
    try {
      cwd = await resolveWorkdir(parsed.data.cwd);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Invalid working directory", code: "INVALID_CWD" },
        { status: 400 }
      );
    }

    const session = await prisma.assistantSession.create({
      data: { ...parsed.data, cwd },
    });
    return NextResponse.json({ session }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/assistant/sessions]", err);
    return NextResponse.json({ error: "Internal server error", code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
