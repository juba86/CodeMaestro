import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { orchestrateRunSchema, formatZodError } from "@/lib/validation/schemas";
import { orchestrateRun } from "@/lib/assistant/orchestrator";
import { resolveWorkdir } from "@/lib/assistant/security";
import { SessionBusyError, isSessionBusy } from "@/lib/assistant/run-hub";
import { launchRun, persistUserMessage, toSessionRow } from "@/lib/assistant/session-run";

export const runtime = "nodejs";

/**
 * Hybrid orchestration: executes a (user-edited) plan as a server-side run
 * (202 + runId); events via GET /api/assistant/sessions/[id]/events.
 */
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
  const { prompt, subtasks, clientProviders, plannerWorkerId } = parsed.data;

  const session = await prisma.assistantSession.findUnique({ where: { id } });
  if (!session) {
    return NextResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
  }
  if (isSessionBusy(id)) {
    return NextResponse.json({ error: new SessionBusyError().message, code: "SESSION_BUSY" }, { status: 409 });
  }
  try {
    await resolveWorkdir(session.cwd);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid working directory", code: "INVALID_CWD" },
      { status: 400 }
    );
  }

  try {
    await persistUserMessage(id, prompt);
    const row = toSessionRow(session);
    const run = await launchRun({
      sessionId: id,
      kind: "orchestrate",
      origin: "pwa",
      title: `[orchestrate] ${prompt}`,
      work: (ctx) => orchestrateRun(ctx, row, prompt, { subtasks, clientProviders, plannerWorkerId }),
    });
    return NextResponse.json({ runId: run.info.runId, startedAt: run.info.startedAt }, { status: 202 });
  } catch (err) {
    if (err instanceof SessionBusyError) {
      return NextResponse.json({ error: err.message, code: "SESSION_BUSY" }, { status: 409 });
    }
    console.error("[POST orchestrate/run]", err);
    return NextResponse.json({ error: "Internal server error", code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
