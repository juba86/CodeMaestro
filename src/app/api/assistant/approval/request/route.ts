import { NextRequest, NextResponse } from "next/server";
import { requestApproval } from "@/lib/assistant/approvals";

export const runtime = "nodejs";
export const maxDuration = 400;

// Called by the PreToolUse hook. Long-polls until the user decides in the UI.
export async function POST(req: NextRequest) {
  let body: { sessionId?: string; tool?: string; input?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ decision: "deny", reason: "Invalid JSON" }, { status: 400 });
  }
  if (!body.sessionId || !body.tool) {
    return NextResponse.json({ decision: "deny", reason: "Missing fields" }, { status: 400 });
  }
  const result = await requestApproval(body.sessionId, body.tool, body.input || {});
  return NextResponse.json(result);
}
