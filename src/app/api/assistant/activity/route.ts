import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getActiveRun } from "@/lib/assistant/run-hub";
import { listPending } from "@/lib/assistant/approvals";
import { buildActivity } from "@/lib/activity";

// Read-only snapshot of the in-memory run hub (DESIGN.md §4.4), polled by
// useActivity(). GET passes the CSRF guard in src/proxy.ts (safe method); the
// optional Tailscale identity allowlist still applies.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const sessions = await prisma.assistantSession.findMany({
      select: { id: true, title: true, cwd: true, provider: true, model: true },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
    return NextResponse.json(buildActivity(sessions, getActiveRun, listPending, Date.now()), { headers: NO_STORE });
  } catch (err) {
    console.error("[GET /api/assistant/activity]", err);
    return NextResponse.json(
      { error: "Aktivität konnte nicht geladen werden.", code: "INTERNAL_ERROR" },
      { status: 500, headers: NO_STORE }
    );
  }
}
