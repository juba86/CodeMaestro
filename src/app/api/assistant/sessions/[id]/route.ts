import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { stopDev } from "@/lib/assistant/devserver";
import { getActiveRun } from "@/lib/assistant/run-hub";
import { listPending } from "@/lib/assistant/approvals";
import { stopRunNow } from "@/lib/assistant/session-run";

export const runtime = "nodejs";

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

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  stopRunNow(id);
  stopDev(id);
  try {
    await prisma.assistantSession.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
  }
}
