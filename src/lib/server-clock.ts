// Client-side estimate of the server clock. Deadlines such as an approval's
// `expiresAt` are stamped by the server; comparing them with the device clock
// is wrong whenever that clock is off (a phone 3 minutes fast shows valid
// approvals as expired). serverNow() = Date.now() + offset, where
// offset = server clock − client clock is learned from two sources:
//
//  - Responses carrying the server time (the activity poll's `serverTime`):
//    it was stamped between sending the request (t0) and receiving the
//    response (t1), so offset ∈ [serverTime − t1, serverTime − t0]. The
//    midpoint is taken (error ≤ half the round trip) and replaces the estimate.
//  - SSE run events carrying `at` (server publish time): an event arrives only
//    after it was published, so offset ≥ at − receivedAt. That is a lower
//    bound only — events replayed from the run buffer can be minutes old — so
//    it may raise the estimate but never lower it.
//
// Plain module state without DOM access: SSR-safe. Only client code feeds it,
// so on the server serverNow() is just Date.now().

/** Round trips longer than this (slow network, device slept mid-request) say too little. */
const MAX_RTT_MS = 10_000;
/**
 * Smaller changes are round-trip jitter: not applied, so subscribers do not
 * re-render after every poll. Countdowns show whole seconds.
 */
const MIN_CHANGE_MS = 250;

let offset = 0;
const listeners = new Set<() => void>();

const isTime = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

/**
 * Offset estimate from a response stamped with `serverTime` that was requested
 * at `sentAt` and received at `receivedAt` (client epoch ms), or null when the
 * sample is unusable (missing time, clock jumped, round trip too long).
 */
export function offsetFromResponse(serverTime: unknown, sentAt: number, receivedAt: number): number | null {
  if (!isTime(serverTime) || !isTime(sentAt) || !isTime(receivedAt)) return null;
  const rtt = receivedAt - sentAt;
  if (rtt < 0 || rtt > MAX_RTT_MS) return null;
  return Math.round(serverTime - (sentAt + receivedAt) / 2);
}

/** Lower bound on the offset proven by an event published at `at` (server) and received at `receivedAt` (client). */
export function offsetLowerBound(at: unknown, receivedAt: number): number | null {
  if (!isTime(at) || !isTime(receivedAt)) return null;
  return Math.round(at - receivedAt);
}

function apply(next: number) {
  if (Math.abs(next - offset) < MIN_CHANGE_MS) return;
  offset = next;
  for (const l of listeners) l();
}

/** Feeds a response's server timestamp (see offsetFromResponse). */
export function noteServerTime(serverTime: unknown, sentAt: number, receivedAt: number = Date.now()): void {
  const next = offsetFromResponse(serverTime, sentAt, receivedAt);
  if (next !== null) apply(next);
}

/** Feeds an SSE event's `at`; only ever raises the estimate (see offsetLowerBound). */
export function noteServerEvent(at: unknown, receivedAt: number = Date.now()): void {
  const lower = offsetLowerBound(at, receivedAt);
  if (lower !== null && lower > offset) apply(lower);
}

/** Current estimate of server clock − client clock (ms); 0 until a sample arrived. */
export function serverClockOffset(): number {
  return offset;
}

/** Current time on the server's clock (epoch ms) — compare server-stamped deadlines with this. */
export function serverNow(): number {
  return Date.now() + offset;
}

/** Notifies `listener` when the offset changes (useSyncExternalStore-compatible). */
export function subscribeServerClock(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
