import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { assistantMessageSchema, formatZodError } from "@/lib/validation/schemas";
import { resolveWorkdir } from "@/lib/assistant/security";
import { SessionBusyError, isSessionBusy } from "@/lib/assistant/run-hub";
import { executeTurn, launchRun, persistUserMessage } from "@/lib/assistant/session-run";

export const runtime = "nodejs";

/**
 * Starts one assistant turn and returns immediately (202 + runId). The turn
 * runs server-side, independent of this request; the client follows it via
 * GET /api/assistant/sessions/[id]/events (SSE, resumable). Closing the
 * window therefore never interrupts or loses the work.
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
  const parsed = assistantMessageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error), code: "VALIDATION_ERROR" }, { status: 400 });
  }
  const { prompt, apiKey, useKnowledge } = parsed.data;

  const session = await prisma.assistantSession.findUnique({ where: { id } });
  if (!session) {
    return NextResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
  }
  if (isSessionBusy(id)) {
    return NextResponse.json(
      { error: new SessionBusyError().message, code: "SESSION_BUSY" },
      { status: 409 }
    );
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
    await persistUserMessage(id, prompt);
    const run = await launchRun({
      sessionId: id,
      kind: "turn",
      origin: "pwa",
      title: prompt,
      work: (ctx) => executeTurn(ctx, prompt, { apiKey, useKnowledge, interactive: true }),
    });
    return NextResponse.json({ runId: run.info.runId, startedAt: run.info.startedAt }, { status: 202 });
  } catch (err) {
    if (err instanceof SessionBusyError) {
      return NextResponse.json({ error: err.message, code: "SESSION_BUSY" }, { status: 409 });
    }
    console.error("[POST message]", err);
    return NextResponse.json({ error: "Internal server error", code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
