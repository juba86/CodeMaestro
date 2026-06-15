import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { orchestrateRunSchema, formatZodError } from "@/lib/validation/schemas";
import { executePlan, type OrchEvent } from "@/lib/assistant/orchestrator";
import { resolveWorkdir } from "@/lib/assistant/security";
import type { AssistantSessionRow } from "@/lib/assistant/runner";

export const runtime = "nodejs";
export const maxDuration = 3600;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body", code: "INVALID_JSON" }, { status: 400 });
  }
  const parsed = orchestrateRunSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error), code: "VALIDATION_ERROR" }, { status: 400 });
  }
  const { prompt, subtasks } = parsed.data;

  const session = await prisma.assistantSession.findUnique({ where: { id } });
  if (!session) {
    return NextResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
  }
  if (session.status === "running") {
    return NextResponse.json(
      { error: "In dieser Session läuft bereits eine Aufgabe. Bitte erst stoppen.", code: "SESSION_BUSY" },
      { status: 409 }
    );
  }
  try {
    await resolveWorkdir(session.cwd);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid cwd", code: "INVALID_CWD" }, { status: 400 });
  }

  await prisma.assistantMessage.create({ data: { sessionId: id, role: "user", content: prompt } });
  await prisma.assistantSession.update({
    where: { id },
    data: { status: "running", title: session.title || `[orchestrate] ${prompt.slice(0, 60)}` },
  });

  const sessionRow: AssistantSessionRow = {
    id: session.id, externalId: session.externalId, provider: session.provider,
    model: session.model, cwd: session.cwd, permissionMode: session.permissionMode, allowedTools: session.allowedTools, sandbox: session.sandbox,
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: OrchEvent) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`)); } catch { /* client gone */ }
      };
      let result;
      try {
        result = await executePlan(sessionRow, prompt, subtasks, send);
      } catch (err) {
        send({ type: "error", content: err instanceof Error ? err.message : "Run failed" });
        result = { costUsd: 0, isError: true, records: [] };
      }
      if (result.records.length) {
        await prisma.assistantMessage.createMany({ data: result.records.map((r) => ({ sessionId: id, ...r })) });
      }
      await prisma.assistantSession.update({
        where: { id },
        data: { status: result.isError ? "error" : "idle", totalCostUsd: { increment: result.costUsd || 0 } },
      });
      try { controller.enqueue(encoder.encode("data: [DONE]\n\n")); } catch { /* client gone */ }
      try { controller.close(); } catch { /* already closed */ }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
