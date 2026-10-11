import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { stopDev } from "@/lib/assistant/devserver";
import { getActiveRun, isSessionBusy } from "@/lib/assistant/run-hub";
import { listPending } from "@/lib/assistant/approvals";
import { stopRunNow } from "@/lib/assistant/session-run";
import { deletePiSessionFiles, isValidPiModelId } from "@/lib/assistant/pi";
import { formatZodError } from "@/lib/validation/schemas";

export const runtime = "nodejs";

const patchSchema = z.object({ model: z.string().trim().min(1).max(200) });

/**
 * Returns the session, its persisted transcript and — when work is running —
 * the live run. While a run is active and its event buffer is complete, the
 * transcript is cut at the run start: the client replays the run from
 * `since=0` over SSE, so nothing is shown twice. For very long runs whose
 * buffer was trimmed, the full transcript is returned and the client attaches
 * from `run.lastSeq` instead.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const run = getActiveRun(id);
  const session = await prisma.assistantSession.findUnique({
    where: { id },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
        ...(run?.complete ? { where: { createdAt: { lt: new Date(run.startedAt) } } } : {}),
      },
    },
  });
  if (!session) {
    return NextResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
  }
  // A DB status of "running" without a live run is stale (e.g. crash) — report idle.
  const status = session.status === "running" && !run ? "idle" : session.status;
  return NextResponse.json({
    session: { ...session, status },
    run: run
      ? {
          runId: run.runId,
          kind: run.kind,
          origin: run.origin,
          startedAt: run.startedAt,
          lastSeq: run.lastSeq,
          complete: run.complete,
          attachFrom: run.complete ? 0 : run.lastSeq,
          pending: listPending(id),
        }
      : null,
  });
}

/**
 * Changes the session's model (body: {model}). It applies from the next
 * message or loop; the conversation so far is kept. Refused while the session
 * runs, so a turn never switches models half way.
 */
export async function PATCH(
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
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error), code: "VALIDATION_ERROR" }, { status: 400 });
  }
  const session = await prisma.assistantSession.findUnique({ where: { id }, select: { provider: true } });
  if (!session) {
    return NextResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
  }
  if (isSessionBusy(id)) {
    return NextResponse.json({ error: "Die Session läuft gerade – das Modell lässt sich erst danach wechseln.", code: "SESSION_BUSY" }, { status: 409 });
  }
  if (session.provider === "pi" && !isValidPiModelId(parsed.data.model)) {
    return NextResponse.json({ error: `Ungültige Modell-ID für pi: ${parsed.data.model}`, code: "VALIDATION_ERROR" }, { status: 400 });
  }
  const updated = await prisma.assistantSession.update({ where: { id }, data: { model: parsed.data.model } });
  return NextResponse.json({ session: updated });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  stopRunNow(id);
  stopDev(id);
  try {
    const deleted = await prisma.assistantSession.delete({ where: { id } });
    // pi keeps its own transcript files; drop them with the session — also
    // those of pi orchestrator workers, which any session can run.
    void deletePiSessionFiles(deleted.provider === "pi" ? deleted.externalId : null, deleted.id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
  }
}
