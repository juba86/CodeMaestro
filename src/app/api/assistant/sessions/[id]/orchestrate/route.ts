import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { orchestrateSchema, formatZodError } from "@/lib/validation/schemas";
import { orchestrateRun } from "@/lib/assistant/orchestrator";
import { resolveOrchestra } from "@/lib/assistant/orchestra";
import { resolveWorkdir } from "@/lib/assistant/security";
import { SessionBusyError, isSessionBusy } from "@/lib/assistant/run-hub";
import { launchRun, persistUserMessage, toSessionRow } from "@/lib/assistant/session-run";

export const runtime = "nodejs";

/**
 * Auto orchestration: plans the task, runs the subtasks on the routed workers
 * and synthesizes — as a server-side run (202 + runId). Clients follow it via
 * GET /api/assistant/sessions/[id]/events; Stop aborts it between and within
 * subtasks.
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
  const parsed = orchestrateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error), code: "VALIDATION_ERROR" }, { status: 400 });
  }
  const { prompt, preference, clientProviders, plannerWorkerId } = parsed.data;

  const session = await prisma.assistantSession.findUnique({ where: { id } });
  if (!session) {
    return NextResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
  }
  if (isSessionBusy(id)) {
    return NextResponse.json({ error: new SessionBusyError().message, code: "SESSION_BUSY" }, { status: 409 });
  }

  // Re-validate the working directory at run time (defense in depth).
  try {
    await resolveWorkdir(session.cwd);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid working directory", code: "INVALID_CWD" },
      { status: 400 }
    );
  }

  try {
    // Unsaved chart edits from the request win over the saved orchestra.
    const orchestra = await resolveOrchestra(parsed.data.orchestra);
    await persistUserMessage(id, prompt);
    const row = toSessionRow(session);
    const run = await launchRun({
      sessionId: id,
      kind: "orchestrate",
      origin: "pwa",
      title: `[orchestrate] ${prompt}`,
      work: (ctx) => orchestrateRun(ctx, row, prompt, { preference, clientProviders, plannerWorkerId, orchestra }),
    });
    return NextResponse.json({ runId: run.info.runId, startedAt: run.info.startedAt }, { status: 202 });
  } catch (err) {
    if (err instanceof SessionBusyError) {
      return NextResponse.json({ error: err.message, code: "SESSION_BUSY" }, { status: 409 });
    }
    console.error("[POST orchestrate]", err);
    return NextResponse.json({ error: "Internal server error", code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
