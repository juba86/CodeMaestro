import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { fireSchedule } from "@/lib/schedule/schedules";
import { SCHEDULE_PAYLOAD_MAX } from "@/lib/schedule/types";

export const runtime = "nodejs";

// Webhook bodies are handed to the agent clipped; refuse the absurd ones early.
const MAX_BODY_BYTES = 256 * 1024;
const STATUS: Record<string, number> = { busy: 409, disabled: 409, session_missing: 404, invalid_cwd: 400, unchanged: 409, error: 500 };

/**
 * Webhook trigger: POST /api/assistant/schedules/trigger/<token> starts the
 * schedule's run with the request body as context for the agent (JSON or
 * text, e.g. a GitHub push event or a CI failure). The token is the only
 * credential: anyone who can reach this server with it can start the run —
 * keep the app on the tailnet. Non-browser callers pass the CSRF guard
 * (src/proxy.ts); the optional Tailscale identity allowlist still applies.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length > 200) return NextResponse.json({ error: "Unbekannter Trigger.", code: "NOT_FOUND" }, { status: 404 });
  const length = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Body zu groß.", code: "PAYLOAD_TOO_LARGE" }, { status: 413 });
  }
  const schedule = await prisma.sessionSchedule.findUnique({ where: { triggerToken: token } });
  if (!schedule) return NextResponse.json({ error: "Unbekannter Trigger.", code: "NOT_FOUND" }, { status: 404 });

  let payload = "";
  try {
    const raw = (await req.text()).slice(0, MAX_BODY_BYTES);
    payload = raw.slice(0, SCHEDULE_PAYLOAD_MAX * 2); // clipped again for the prompt
  } catch {
    payload = "";
  }
  const r = await fireSchedule(schedule, { reason: "webhook", payload, requireEnabled: true });
  if (!r.started) {
    return NextResponse.json({ error: r.message, code: r.reason.toUpperCase() }, { status: STATUS[r.reason] ?? 500 });
  }
  return NextResponse.json({ runId: r.runId, sessionId: schedule.sessionId }, { status: 202 });
}
