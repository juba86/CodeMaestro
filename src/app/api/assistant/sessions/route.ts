import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { createAssistantSessionSchema, formatZodError } from "@/lib/validation/schemas";
import { resolveWorkdir } from "@/lib/assistant/security";
import { isSessionBusy } from "@/lib/assistant/run-hub";
import { supportsApprovalGate } from "@/lib/assistant/runner";

export const runtime = "nodejs";

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
      // A DB "running" without a live run is stale (e.g. after a crash).
      status: s.status === "running" && !isSessionBusy(s.id) ? "idle" : s.status,
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

    // The approval gate/sandbox are enforced through provider hooks; never
    // store a gate the provider cannot honor (the runner would refuse to run).
    const data = supportsApprovalGate(parsed.data.provider)
      ? { ...parsed.data, cwd }
      : { ...parsed.data, cwd, approvalMode: "off" as const, sandbox: false };
    const session = await prisma.assistantSession.create({ data });
    return NextResponse.json({ session }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/assistant/sessions]", err);
    return NextResponse.json({ error: "Internal server error", code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
