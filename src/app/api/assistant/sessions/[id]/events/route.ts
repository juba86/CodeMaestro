import { NextRequest } from "next/server";
import { sseResponse } from "@/lib/assistant/run-hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Attaches to a session's run as an SSE stream (works with EventSource).
 * Replays buffered events after `?since=<seq>` (or the Last-Event-ID header an
 * EventSource sends on auto-reconnect), then streams live until `run_end`.
 * With no run active it sends `{type:"idle"}` and closes. Disconnecting only
 * detaches this listener — the run itself keeps going.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const fromHeader = Number(req.headers.get("last-event-id"));
  const fromQuery = Number(req.nextUrl.searchParams.get("since"));
  const since = Number.isFinite(fromHeader) && fromHeader > 0
    ? fromHeader
    : Number.isFinite(fromQuery) && fromQuery > 0 ? fromQuery : 0;
  return sseResponse(id, since, req.signal);
}
