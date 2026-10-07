import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { addSubscription, removeSubscription } from "@/lib/push";

export const runtime = "nodejs";

// The server POSTs to stored endpoints, so only accept the browser vendors'
// push services (Chrome/Android/Opera: FCM, Firefox: autopush, Safari/iOS:
// Apple, Edge: WNS) — never an arbitrary URL on the network.
const PUSH_SERVICE_SUFFIXES = ["googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com"];

const endpointSchema = z
  .string()
  .max(2048)
  .refine((v) => {
    try {
      const u = new URL(v);
      const host = u.hostname.toLowerCase();
      return (
        u.protocol === "https:" &&
        PUSH_SERVICE_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`))
      );
    } catch {
      return false;
    }
  }, "endpoint must be a known push service URL");

/** URL-safe base64 (padding optional) decoding to exactly `bytes` bytes. */
function b64urlOfLength(bytes: number, check?: (buf: Buffer) => boolean) {
  return z
    .string()
    .max(256)
    .refine((v) => {
      if (!/^[A-Za-z0-9_-]+={0,2}$/.test(v)) return false;
      const buf = Buffer.from(v, "base64url");
      return buf.length === bytes && (!check || check(buf));
    }, "invalid key");
}

// Malformed keys would make every later send fail with an encryption error that
// is never pruned (only 404/410 are) — reject them up front.
const subscribeSchema = z.object({
  endpoint: endpointSchema,
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    // Uncompressed P-256 public point: 0x04 || X || Y.
    p256dh: b64urlOfLength(65, (buf) => buf[0] === 0x04),
    auth: b64urlOfLength(16),
  }),
});

const unsubscribeSchema = z.object({ endpoint: endpointSchema });

async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

export async function POST(req: NextRequest) {
  const body = await readJson(req);
  if (body === undefined) return NextResponse.json({ error: "Invalid JSON", code: "INVALID_JSON" }, { status: 400 });
  const parsed = subscribeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültiges Push-Abonnement", code: "VALIDATION_ERROR" }, { status: 400 });
  }
  try {
    await addSubscription(parsed.data, req.headers.get("user-agent") ?? undefined);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[push] subscribe failed", err);
    return NextResponse.json({ error: "Abonnement konnte nicht gespeichert werden.", code: "INTERNAL_ERROR" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const body = await readJson(req);
  if (body === undefined) return NextResponse.json({ error: "Invalid JSON", code: "INVALID_JSON" }, { status: 400 });
  const parsed = unsubscribeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültiger Endpoint", code: "VALIDATION_ERROR" }, { status: 400 });
  }
  try {
    const removed = await removeSubscription(parsed.data.endpoint);
    return NextResponse.json({ ok: true, removed });
  } catch (err) {
    console.error("[push] unsubscribe failed", err);
    return NextResponse.json({ error: "Abonnement konnte nicht entfernt werden.", code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
