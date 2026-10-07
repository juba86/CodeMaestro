import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { orchestrateSchema, formatZodError } from "@/lib/validation/schemas";
import { discoverAllWorkers } from "@/lib/assistant/orchestrator";

export const runtime = "nodejs";

// Same client-provider validation as the orchestrate routes (shape, lengths,
// max 20 entries) — reused from orchestrateSchema.
const workersBodySchema = z.object({
  clientProviders: orchestrateSchema.shape.clientProviders,
});

// Lists the worker pool (file-editing CLIs + every local Ollama model + the
// user's configured cloud/custom providers) so the UI can populate the
// orchestrator's "planner model" dropdown. No session needed — discovery is
// global. Body (optional): { clientProviders?: ClientProvider[] }.
export async function POST(req: NextRequest) {
  let body: unknown = {};
  try {
    const text = await req.text();
    if (text.trim()) body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body", code: "INVALID_JSON", workers: [] }, { status: 400 });
  }
  const parsed = workersBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: formatZodError(parsed.error), code: "VALIDATION_ERROR", workers: [] },
      { status: 400 }
    );
  }

  try {
    const workers = await discoverAllWorkers(parsed.data.clientProviders);
    return NextResponse.json({
      workers: workers.map((w) => ({ id: w.id, label: w.label, kind: w.kind, editsFiles: w.editsFiles })),
    });
  } catch (err) {
    console.error("[orchestrate/workers]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Worker-Erkennung fehlgeschlagen", code: "DISCOVERY_FAILED", workers: [] },
      { status: 500 }
    );
  }
}
