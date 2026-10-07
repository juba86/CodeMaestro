import { NextRequest, NextResponse } from "next/server";
import { resolveApproval } from "@/lib/assistant/approvals";

export const runtime = "nodejs";

// Called by the browser when the user approves/denies a tool action or answers
// an interactive question.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let body: { decision?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const decision = body.decision === "allow" ? "allow" : "deny";
  const reason = typeof body.reason === "string" ? body.reason : undefined;
  const ok = resolveApproval(id, decision, reason);
  return NextResponse.json({ ok }, { status: ok ? 200 : 410 });
}
