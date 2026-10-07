// Web Push for the installed PWA: tells the user when a server-side assistant
// run needs them (approval / question) or has finished — useful now that runs
// keep going after the window is closed.
//
// Storage (Setting table, JSON values):
//   push.vapid          {publicKey, privateKey} — generated once, never rotated
//                       automatically (rotation would orphan every subscription)
//   push.subscriptions  PushSubscriptionRecord[] — deduped by endpoint, entries
//                       the push service reports as gone (404/410) are dropped
//
// State lives on globalThis: route handlers and the instrumentation-started
// Telegram bridge run in separate module graphs but must share throttling.

import webpush from "web-push";
import { prisma } from "@/lib/db/client";
import { listenerCount } from "@/lib/assistant/run-hub";

const VAPID_KEY = "push.vapid";
const SUBSCRIPTIONS_KEY = "push.subscriptions";
// RFC 8292 wants a mailto: or https: contact. Apple rejects localhost /
// unreachable contacts with 403 BadJwtToken, so the default is the project's
// public homepage; set CODEMAESTRO_PUSH_SUBJECT=mailto:you@your-domain to use your own.
const DEFAULT_SUBJECT = "https://github.com/Muchel187/CodeMaestro";
const THROTTLE_MS = 15_000;
const MAX_SUBSCRIPTIONS = 50;
const SEND_TIMEOUT_MS = 10_000;

export type NotifyKind = "approval" | "question" | "run_end";

export interface NotifyInfo {
  title?: string;
  detail?: string;
  status?: string;
}

export interface PushSubscriptionRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  createdAt: number;
  userAgent?: string;
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

interface PushState {
  vapid: Promise<VapidKeys> | null;
  lock: Promise<unknown>;
  lastSent: Map<string, number>;
}

const g = globalThis as unknown as { __cmPush?: PushState };
function state(): PushState {
  if (!g.__cmPush) g.__cmPush = { vapid: null, lock: Promise.resolve(), lastSent: new Map() };
  return g.__cmPush;
}

/** Serializes read-modify-write cycles on the subscription list. */
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const s = state();
  const run = s.lock.then(fn, fn);
  s.lock = run.catch(() => {});
  return run;
}

export function pushSubject(): string {
  const raw = process.env.CODEMAESTRO_PUSH_SUBJECT?.trim();
  if (!raw) return DEFAULT_SUBJECT;
  try {
    const u = new URL(raw);
    if (u.protocol === "mailto:" || u.protocol === "https:") return raw;
  } catch {
    /* fall through */
  }
  console.warn("[push] CODEMAESTRO_PUSH_SUBJECT must be a mailto: or https: URL — using the default");
  return DEFAULT_SUBJECT;
}

function parseVapid(value: string): VapidKeys | null {
  try {
    const v = JSON.parse(value) as Partial<VapidKeys>;
    if (typeof v.publicKey === "string" && typeof v.privateKey === "string" && v.publicKey && v.privateKey) {
      return { publicKey: v.publicKey, privateKey: v.privateKey };
    }
  } catch {
    /* corrupt */
  }
  return null;
}

async function loadOrCreateVapid(): Promise<VapidKeys> {
  const row = await prisma.setting.findUnique({ where: { key: VAPID_KEY } });
  if (row) {
    const parsed = parseVapid(row.value);
    if (parsed) return parsed;
    // Unreadable row: replace it (existing subscriptions are unusable anyway).
    const keys = webpush.generateVAPIDKeys();
    await prisma.setting.update({ where: { key: VAPID_KEY }, data: { value: JSON.stringify(keys) } });
    await withLock(() => writeSubscriptions([]));
    return keys;
  }
  const keys = webpush.generateVAPIDKeys();
  try {
    await prisma.setting.create({ data: { key: VAPID_KEY, value: JSON.stringify(keys) } });
    return keys;
  } catch {
    // Lost a creation race (unique key) — use the winner's keys.
    const again = await prisma.setting.findUnique({ where: { key: VAPID_KEY } });
    const parsed = again ? parseVapid(again.value) : null;
    if (parsed) return parsed;
    throw new Error("VAPID-Schlüssel konnten nicht gespeichert werden.");
  }
}

async function getVapidKeys(): Promise<VapidKeys> {
  const s = state();
  if (!s.vapid) {
    s.vapid = loadOrCreateVapid().catch((err) => {
      s.vapid = null;
      throw err;
    });
  }
  return s.vapid;
}

/** The application server key the browser subscribes with (URL-safe base64). */
export async function getVapidPublicKey(): Promise<string> {
  return (await getVapidKeys()).publicKey;
}

function isRecord(v: unknown): v is PushSubscriptionRecord {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  const keys = r.keys as Record<string, unknown> | undefined;
  return (
    typeof r.endpoint === "string" &&
    !!keys &&
    typeof keys.p256dh === "string" &&
    typeof keys.auth === "string"
  );
}

async function readSubscriptions(): Promise<PushSubscriptionRecord[]> {
  const row = await prisma.setting.findUnique({ where: { key: SUBSCRIPTIONS_KEY } });
  if (!row) return [];
  try {
    const list = JSON.parse(row.value) as unknown;
    return Array.isArray(list) ? list.filter(isRecord) : [];
  } catch {
    return [];
  }
}

async function writeSubscriptions(list: PushSubscriptionRecord[]): Promise<void> {
  const value = JSON.stringify(list);
  await prisma.setting.upsert({
    where: { key: SUBSCRIPTIONS_KEY },
    update: { value },
    create: { key: SUBSCRIPTIONS_KEY, value },
  });
}

/** Stores (or refreshes) a browser subscription. */
export async function addSubscription(
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  userAgent?: string
): Promise<void> {
  await withLock(async () => {
    const list = (await readSubscriptions()).filter((s) => s.endpoint !== sub.endpoint);
    list.push({
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      createdAt: Date.now(),
      userAgent: userAgent?.slice(0, 200),
    });
    // Oldest first — drop the oldest beyond the cap.
    await writeSubscriptions(list.slice(-MAX_SUBSCRIPTIONS));
  });
}

export async function removeSubscription(endpoint: string): Promise<boolean> {
  return withLock(async () => {
    const list = await readSubscriptions();
    const next = list.filter((s) => s.endpoint !== endpoint);
    if (next.length === list.length) return false;
    await writeSubscriptions(next);
    return true;
  });
}

export async function subscriptionCount(): Promise<number> {
  return (await readSubscriptions()).length;
}

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Sends a payload to every stored subscription (or only `onlyEndpoint`).
 * Subscriptions the push service reports as gone are removed.
 */
export async function sendPush(
  payload: PushPayload,
  opts: { onlyEndpoint?: string; ttlSec?: number; urgency?: "normal" | "high"; topic?: string } = {}
): Promise<{ sent: number; failed: number; removed: number }> {
  const [vapid, all] = await Promise.all([getVapidKeys(), readSubscriptions()]);
  const targets = opts.onlyEndpoint ? all.filter((s) => s.endpoint === opts.onlyEndpoint) : all;
  if (!targets.length) return { sent: 0, failed: 0, removed: 0 };

  const body = JSON.stringify(payload);
  // RFC 8030 topic: ≤32 chars of the URL-safe base64 alphabet. A newer message
  // with the same topic replaces an undelivered older one at the push service.
  const topic = opts.topic && /^[A-Za-z0-9_-]{1,32}$/.test(opts.topic) ? opts.topic : undefined;
  const results = await Promise.allSettled(
    targets.map((s) =>
      webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, body, {
        vapidDetails: { subject: pushSubject(), publicKey: vapid.publicKey, privateKey: vapid.privateKey },
        TTL: opts.ttlSec ?? 3600,
        urgency: opts.urgency ?? "normal",
        topic,
        timeout: SEND_TIMEOUT_MS,
      })
    )
  );

  const gone = new Set<string>();
  let sent = 0;
  let failed = 0;
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      sent++;
      return;
    }
    failed++;
    const code = (r.reason as { statusCode?: number } | null)?.statusCode;
    if (code === 404 || code === 410) {
      gone.add(targets[i].endpoint);
    } else {
      const host = (() => { try { return new URL(targets[i].endpoint).host; } catch { return "?"; } })();
      const detail = r.reason instanceof Error ? r.reason.message : String(r.reason);
      console.warn(`[push] delivery to ${host} failed${code ? ` (HTTP ${code})` : ""}: ${detail}`);
    }
  });

  if (gone.size) {
    await withLock(async () => {
      const list = await readSubscriptions();
      await writeSubscriptions(list.filter((s) => !gone.has(s.endpoint)));
    });
  }
  return { sent, failed, removed: gone.size };
}

const RUN_END_TITLES: Record<string, string> = {
  idle: "Aufgabe abgeschlossen",
  error: "Aufgabe mit Fehler beendet",
  stopped: "Aufgabe gestoppt",
};

function shouldThrottle(key: string): boolean {
  const s = state();
  const now = Date.now();
  if (now - (s.lastSent.get(key) ?? 0) < THROTTLE_MS) return true;
  s.lastSent.set(key, now);
  if (s.lastSent.size > 500) {
    for (const [k, t] of s.lastSent) if (now - t >= THROTTLE_MS) s.lastSent.delete(k);
  }
  return false;
}

/**
 * Notifies the user's devices about a session event — but only when nobody is
 * watching the session live (no SSE/bridge listener attached). Throttled per
 * session + kind. Never throws.
 *
 * The listener check runs synchronously at call time, before the first await:
 * callers may detach listeners right after calling (run_end closes streams).
 */
export async function notifySession(sessionId: string, kind: NotifyKind, info: NotifyInfo = {}): Promise<void> {
  try {
    if (listenerCount(sessionId) > 0) return;
    if (shouldThrottle(`${sessionId}:${kind}`)) return;
    if ((await subscriptionCount()) === 0) return;

    const session = await prisma.assistantSession
      .findUnique({ where: { id: sessionId }, select: { title: true } })
      .catch(() => null);
    const context = clip(info.title || session?.title || "", 80);

    let title: string;
    let fallback: string;
    if (kind === "approval") {
      title = "Freigabe nötig";
      fallback = "Der Assistent wartet auf deine Freigabe.";
    } else if (kind === "question") {
      title = "Rückfrage vom Assistenten";
      fallback = "Der Assistent wartet auf deine Antwort.";
    } else {
      title = RUN_END_TITLES[info.status ?? "idle"] ?? RUN_END_TITLES.idle;
      fallback = "";
    }
    const detail = clip(info.detail || fallback, 160);
    const body = [context, detail].filter(Boolean).join("\n") || "CodeMaestro";

    const waiting = kind !== "run_end";
    await sendPush(
      { title, body, url: `/assistant?session=${encodeURIComponent(sessionId)}`, tag: `cm-${sessionId}` },
      {
        // Approvals auto-deny after their timeout — a later delivery is useless.
        ttlSec: waiting ? 30 * 60 : 12 * 60 * 60,
        urgency: waiting ? "high" : "normal",
        topic: `cm${sessionId}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32),
      }
    );
  } catch (err) {
    console.warn("[push] notifySession failed", err);
  }
}
