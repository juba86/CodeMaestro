import { NextRequest, NextResponse } from "next/server";
import { getSetting, setSetting } from "@/lib/settings";
import { z } from "zod";

// Only a small allowlist of keys is settable via this endpoint.
const ALLOWED = new Set(["geminiAuthMode"]);

const putSchema = z.object({
  key: z.string().min(1),
  value: z.string().max(2000),
});

export async function GET() {
  const geminiAuthMode = await getSetting("geminiAuthMode", "key");
  return NextResponse.json({ settings: { geminiAuthMode } });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON", code: "INVALID_JSON" }, { status: 400 });
  }
  const parsed = putSchema.safeParse(body);
  if (!parsed.success || !ALLOWED.has(parsed.data.key)) {
    return NextResponse.json({ error: "Invalid setting", code: "INVALID_SETTING" }, { status: 400 });
  }
  await setSetting(parsed.data.key, parsed.data.value);
  return NextResponse.json({ ok: true });
}
