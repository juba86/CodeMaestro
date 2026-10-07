import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getActiveRun } from "@/lib/assistant/run-hub";
import { stopRunNow } from "@/lib/assistant/session-run";

export const runtime = "nodejs";

/**
 * Stops whatever runs in the session (turn, orchestration, loop): aborts the
 * run, kills its CLI processes and denies open approvals. The run itself
 * finalizes the status and publishes `run_end`; only a stale "running" status
 * without a live run is reset here directly.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const hadRun = !!getActiveRun(id);
  const { stopped } = stopRunNow(id);
  if (!hadRun) {
    await prisma.assistantSession
      .updateMany({ where: { id, status: "running" }, data: { status: "idle" } })
      .catch(() => {});
  }
  return NextResponse.json({ stopped: stopped || hadRun });
}
