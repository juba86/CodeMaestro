import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { fireSchedule } from "@/lib/schedule/schedules";

export const runtime = "nodejs";

const STATUS: Record<string, number> = { busy: 409, disabled: 409, session_missing: 404, invalid_cwd: 400, unchanged: 409, error: 500 };

// POST → 202 { runId }: runs the schedule now (also when it is switched off).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const schedule = await prisma.sessionSchedule.findUnique({ where: { id } });
  if (!schedule) return NextResponse.json({ error: "Zeitplan nicht gefunden.", code: "NOT_FOUND" }, { status: 404 });
  const r = await fireSchedule(schedule, { reason: "manual" });
  if (!r.started) {
    return NextResponse.json({ error: r.message, code: r.reason.toUpperCase() }, { status: STATUS[r.reason] ?? 500 });
  }
  return NextResponse.json({ runId: r.runId }, { status: 202 });
}
