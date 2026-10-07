import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { formatZodError } from "@/lib/validation/schemas";
import { PI_INSTALL_HINT, piAgentDir, piInfo, syncOllamaModels } from "@/lib/assistant/pi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const syncBodySchema = z.object({ force: z.boolean().optional().default(true) });

async function status(force: boolean) {
  // Version probe and model sync are independent; neither throws.
  const [info, sync] = await Promise.all([piInfo({ force }), syncOllamaModels({ force })]);
  const error = [info.installed ? null : info.error, sync.error].filter(Boolean).join(" · ") || undefined;
  return {
    installed: info.installed,
    version: info.version,
    bin: info.bin,
    agentDir: piAgentDir(),
    ollamaBaseUrl: sync.ollamaBaseUrl,
    contextFallback: sync.contextFallback,
    syncedAt: sync.syncedAt,
    models: sync.models,
    ...(error ? { error } : {}),
    installHint: PI_INSTALL_HINT,
  };
}

// pi coding agent status: installed binary/version and the Ollama models pi can
// use (synced into CodeMaestro's own pi agent dir; cached ~60 s).
export async function GET() {
  return NextResponse.json(await status(false));
}

// Re-sync the Ollama models now (body: {force?: boolean}, default true).
export async function POST(req: NextRequest) {
  let body: unknown = {};
  try {
    const text = await req.text();
    if (text.trim()) body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body", code: "INVALID_JSON" }, { status: 400 });
  }
  const parsed = syncBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error), code: "VALIDATION_ERROR" }, { status: 400 });
  }
  return NextResponse.json(await status(parsed.data.force));
}
