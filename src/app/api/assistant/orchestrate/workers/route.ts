import { NextRequest, NextResponse } from "next/server";
import { discoverAllWorkers, type ClientProvider } from "@/lib/assistant/orchestrator";

export const runtime = "nodejs";

// Lists the worker pool (file-editing CLIs + every local Ollama model + the
// user's configured cloud/custom providers) so the UI can populate the
// orchestrator's "planner model" dropdown. No session needed — discovery is
// global. Body: { clientProviders?: ClientProvider[] }.
export async function POST(req: NextRequest) {
  let clientProviders: ClientProvider[] = [];
  try {
    const body = await req.json();
    if (Array.isArray(body?.clientProviders)) {
      clientProviders = body.clientProviders
        .filter((p: unknown): p is ClientProvider => !!p && typeof (p as ClientProvider).id === "string")
        .slice(0, 20);
    }
  } catch {
    /* empty body is fine */
  }

  try {
    const workers = await discoverAllWorkers(clientProviders);
    return NextResponse.json({
      workers: workers.map((w) => ({ id: w.id, label: w.label, kind: w.kind, editsFiles: w.editsFiles })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Worker discovery failed", workers: [] },
      { status: 200 }
    );
  }
}
