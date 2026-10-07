import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { assistantLoopSchema, formatZodError } from "@/lib/validation/schemas";
import { resolveWorkdir } from "@/lib/assistant/security";
import { SessionBusyError, isSessionBusy } from "@/lib/assistant/run-hub";
import { startLoopRun } from "@/lib/assistant/loop";

export const runtime = "nodejs";

/**
 * Starts Loop mode: the task is repeated server-side until the agent outputs
 * <promise>TEXT</promise>, the iteration cap is hit, or the user stops it.
 * Returns 202 + runId immediately; clients follow the run via
 * GET /api/assistant/sessions/[id]/events, so closing the window never stops it.
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
  const parsed = assistantLoopSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error), code: "VALIDATION_ERROR" }, { status: 400 });
  }

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
    const run = await startLoopRun(id, parsed.data, "pwa");
    return NextResponse.json({ runId: run.info.runId, startedAt: run.info.startedAt }, { status: 202 });
  } catch (err) {
    if (err instanceof SessionBusyError) {
      return NextResponse.json({ error: err.message, code: "SESSION_BUSY" }, { status: 409 });
    }
    console.error("[POST loop]", err);
    return NextResponse.json({ error: "Internal server error", code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
