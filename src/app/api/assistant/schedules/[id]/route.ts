import { NextRequest, NextResponse } from "next/server";
import { deleteSchedule, updateSchedule } from "@/lib/schedule/schedules";
import { formatZodError, schedulePatchSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

// PATCH { …fields } → { schedule }. Changing cron or enabled recomputes the next run.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültiger JSON-Body.", code: "INVALID_JSON" }, { status: 400 });
  }
  const parsed = schedulePatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error), code: "VALIDATION_ERROR" }, { status: 400 });
  }
  try {
    const schedule = await updateSchedule(id, parsed.data);
    if (!schedule) return NextResponse.json({ error: "Zeitplan nicht gefunden.", code: "NOT_FOUND" }, { status: 404 });
    return NextResponse.json({ schedule });
  } catch (err) {
    console.error("[PATCH /api/assistant/schedules/[id]]", err);
    return NextResponse.json({ error: "Zeitplan konnte nicht gespeichert werden.", code: "INTERNAL_ERROR" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = await deleteSchedule(id);
  if (!ok) return NextResponse.json({ error: "Zeitplan nicht gefunden.", code: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
