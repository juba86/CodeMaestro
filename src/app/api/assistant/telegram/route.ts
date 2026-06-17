import { NextRequest, NextResponse } from "next/server";
import { telegramConfigSchema, formatZodError } from "@/lib/validation/schemas";
import { getTelegramConfig, saveTelegramConfig, toPublicConfig } from "@/lib/assistant/telegram-config";
import { startBridge, stopBridge, bridgeStatus } from "@/lib/assistant/telegram";
import { resolveWorkdir } from "@/lib/assistant/security";

export const runtime = "nodejs";

// Current Telegram bridge config (token masked) + live runtime status.
export async function GET() {
  const config = await getTelegramConfig();
  return NextResponse.json({ config: toPublicConfig(config), status: bridgeStatus() });
}

// Save config from the PWA. Applies the change live: (re)starts the bridge when
// enabled, stops it when disabled.
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON", code: "INVALID_JSON" }, { status: 400 });
  }
  const parsed = telegramConfigSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error), code: "VALIDATION_ERROR" }, { status: 400 });
  }

  // Validate the working directory against the sandbox allowlist before saving.
  if (parsed.data.cwd && parsed.data.cwd.trim()) {
    try {
      await resolveWorkdir(parsed.data.cwd);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Invalid working directory", code: "INVALID_CWD" },
        { status: 400 }
      );
    }
  }

  const next = await saveTelegramConfig(parsed.data);

  // Apply live. Restart so token/setting changes take effect immediately.
  stopBridge();
  let startError: string | undefined;
  if (next.enabled && next.token) {
    const r = await startBridge();
    if (!r.ok) startError = r.error;
  }

  return NextResponse.json({ config: toPublicConfig(next), status: bridgeStatus(), startError });
}
