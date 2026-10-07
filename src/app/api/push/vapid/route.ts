import { NextResponse } from "next/server";
import { getVapidPublicKey } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public application server key the browser subscribes with. */
export async function GET() {
  try {
    const publicKey = await getVapidPublicKey();
    return NextResponse.json({ publicKey }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[push] VAPID key unavailable", err);
    return NextResponse.json({ error: "Push ist nicht verfügbar.", code: "PUSH_UNAVAILABLE" }, { status: 500 });
  }
}
