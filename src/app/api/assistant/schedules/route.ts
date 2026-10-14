import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { createSchedule, listSchedules } from "@/lib/schedule/schedules";
import { formatZodError, scheduleCreateSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_PER_SESSION = 20;

// GET [?session=<id>] → { schedules } — all schedules (home widget) or those of one session.
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session")?.trim() || undefined;
  try {
    return NextResponse.json({ schedules: await listSchedules(sessionId) }, { headers: NO_STORE });
  } catch (err) {
    console.error("[GET /api/assistant/schedules]", err);
    return NextResponse.json({ error: "Zeitpläne konnten nicht geladen werden.", code: "INTERNAL_ERROR" }, { status: 500, headers: NO_STORE });
  }
}

// POST { sessionId, name, prompt, cron, … } → 201 { schedule }.
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültiger JSON-Body.", code: "INVALID_JSON" }, { status: 400 });
  }
  const parsed = scheduleCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error), code: "VALIDATION_ERROR" }, { status: 400 });
  }
  const { sessionId, ...input } = parsed.data;
  try {
    const session = await prisma.assistantSession.findUnique({ where: { id: sessionId }, select: { id: true } });
    if (!session) return NextResponse.json({ error: "Session nicht gefunden.", code: "NOT_FOUND" }, { status: 404 });
    const count = await prisma.sessionSchedule.count({ where: { sessionId } });
    if (count >= MAX_PER_SESSION) {
      return NextResponse.json({ error: `Maximal ${MAX_PER_SESSION} Zeitpläne je Session.`, code: "LIMIT" }, { status: 409 });
    }
    const schedule = await createSchedule(sessionId, { ...input, maxRuns: input.maxRuns ?? null });
    return NextResponse.json({ schedule }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/assistant/schedules]", err);
    return NextResponse.json({ error: "Zeitplan konnte nicht gespeichert werden.", code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
