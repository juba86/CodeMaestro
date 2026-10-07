import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sendPush } from "@/lib/push";

export const runtime = "nodejs";

const testSchema = z.object({ endpoint: z.string().max(2048).optional() }).optional();

/**
 * Sends a test notification — to one device when `endpoint` is given (the
 * toggle sends its own), otherwise to every subscribed device.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    const text = await req.text();
    body = text ? JSON.parse(text) : undefined;
  } catch {
    return NextResponse.json({ error: "Invalid JSON", code: "INVALID_JSON" }, { status: 400 });
  }
  const parsed = testSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Anfrage", code: "VALIDATION_ERROR" }, { status: 400 });

  try {
    const result = await sendPush(
      {
        title: "CodeMaestro",
        body: "Test-Benachrichtigung — Push funktioniert.",
        url: "/assistant",
        tag: "cm-test",
      },
      { onlyEndpoint: parsed.data?.endpoint, ttlSec: 300 }
    );
    if (result.sent === 0) {
      return NextResponse.json(
        { error: "Kein aktives Push-Abonnement erreicht.", code: "NO_SUBSCRIPTION", ...result },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[push] test failed", err);
    return NextResponse.json({ error: "Test-Benachrichtigung fehlgeschlagen.", code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
