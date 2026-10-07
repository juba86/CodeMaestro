import { NextRequest, NextResponse } from "next/server";
import { isValidHookToken, waitForDecision } from "@/lib/assistant/approvals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Long-poll used by the approval hook: waits up to ?timeout= seconds (max 55)
// for the user's decision. Returns {status:"pending"} to poll again,
// {status:"decided", decision, reason}, or {status:"unknown"} (expired/unknown
// id — the hook denies).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isValidHookToken(req.headers.get("x-codemaestro-hook-token"))) {
    return NextResponse.json({ status: "unknown" }, { status: 401 });
  }
  const { id } = await params;
  const sec = Math.min(55, Math.max(1, Number(req.nextUrl.searchParams.get("timeout")) || 25));
  const r = await waitForDecision(id, sec * 1000);
  if (r === "pending" || r === "unknown") return NextResponse.json({ status: r });
  return NextResponse.json({ status: "decided", decision: r.decision, reason: r.reason || "" });
}
