import { NextRequest, NextResponse } from "next/server";
import { createApproval, isValidHookToken } from "@/lib/assistant/approvals";

export const runtime = "nodejs";

// Called by the PreToolUse hook (scripts/assistant-approval-hook.mjs). Creates
// the approval/question in the session's live run and returns its id at once;
// the hook then long-polls /approval/[id]/wait. Splitting create + wait keeps
// every HTTP request short (no client/proxy header timeouts) while the user may
// take as long as the approval timeout — e.g. after re-opening a closed window.
export async function POST(req: NextRequest) {
  if (!isValidHookToken(req.headers.get("x-codemaestro-hook-token"))) {
    return NextResponse.json({ decision: "deny", reason: "Unauthorized hook call" }, { status: 401 });
  }
  let body: { sessionId?: string; tool?: string; input?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ decision: "deny", reason: "Invalid JSON" }, { status: 400 });
  }
  if (!body.sessionId || !body.tool) {
    return NextResponse.json({ decision: "deny", reason: "Missing fields" }, { status: 400 });
  }
  const result = await createApproval(body.sessionId, body.tool, body.input || {});
  return NextResponse.json(result);
}
