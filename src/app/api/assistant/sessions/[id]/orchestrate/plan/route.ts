import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { orchestrateSchema, formatZodError } from "@/lib/validation/schemas";
import { planSubtasks, discoverAllWorkers } from "@/lib/assistant/orchestrator";
import { resolveWorkdir } from "@/lib/assistant/security";
import type { AssistantSessionRow } from "@/lib/assistant/runner";

export const runtime = "nodejs";
export const maxDuration = 600;

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
  const parsed = orchestrateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error), code: "VALIDATION_ERROR" }, { status: 400 });
  }

  const session = await prisma.assistantSession.findUnique({ where: { id } });
  if (!session) {
    return NextResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
  }
  try {
    await resolveWorkdir(session.cwd);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid cwd", code: "INVALID_CWD" }, { status: 400 });
  }

  const sessionRow: AssistantSessionRow = {
    id: session.id, externalId: session.externalId, provider: session.provider,
    model: session.model, cwd: session.cwd, permissionMode: session.permissionMode, allowedTools: session.allowedTools, sandbox: session.sandbox,
  };

  try {
    const { subtasks } = await planSubtasks(sessionRow, parsed.data.prompt, parsed.data.preference, parsed.data.clientProviders);
    // Offer the full pool (incl. every local Ollama model + configured cloud APIs)
    // for manual reassignment.
    const allWorkers = await discoverAllWorkers(parsed.data.clientProviders);
    return NextResponse.json({
      workers: allWorkers.map((w) => ({ id: w.id, label: w.label, editsFiles: w.editsFiles, strengths: w.strengths })),
      subtasks,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Planning failed", code: "PLAN_FAILED" },
      { status: 502 }
    );
  }
}
