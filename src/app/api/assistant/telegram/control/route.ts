import { NextRequest, NextResponse } from "next/server";
import { telegramControlSchema, formatZodError } from "@/lib/validation/schemas";
import { startBridge, stopBridge, testToken, bridgeStatus } from "@/lib/assistant/telegram";
import { getTelegramConfig } from "@/lib/assistant/telegram-config";

export const runtime = "nodejs";

// Start / stop the bridge or test a bot token without persisting it.
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON", code: "INVALID_JSON" }, { status: 400 });
  }
  const parsed = telegramControlSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error), code: "VALIDATION_ERROR" }, { status: 400 });
  }

  if (parsed.data.action === "test") {
    const token = parsed.data.token || (await getTelegramConfig()).token;
    if (!token) return NextResponse.json({ ok: false, error: "Kein Token." });
    const r = await testToken(token);
    return NextResponse.json(r);
  }

  if (parsed.data.action === "stop") {
    stopBridge();
    return NextResponse.json({ ok: true, status: bridgeStatus() });
  }

  // start
  const r = await startBridge();
  return NextResponse.json({ ...r, status: bridgeStatus() });
}
