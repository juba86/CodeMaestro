import { useCallback, useSyncExternalStore } from "react";

/**
 * Shared ticking clocks: every component asking for the same interval reads
 * one timer, so fifty countdowns cost one setInterval.
 */
interface Clock {
  now: number;
  listeners: Set<() => void>;
  timer: ReturnType<typeof setInterval> | null;
}

const clocks = new Map<number, Clock>();

function clockFor(intervalMs: number): Clock {
  let clock = clocks.get(intervalMs);
  if (!clock) {
    clock = { now: Date.now(), listeners: new Set(), timer: null };
    clocks.set(intervalMs, clock);
  }
  return clock;
}

function subscribe(intervalMs: number, onChange: () => void): () => void {
  const clock = clockFor(intervalMs);
  clock.listeners.add(onChange);
  if (!clock.timer) {
    clock.now = Date.now();
    clock.timer = setInterval(() => {
      clock.now = Date.now();
      for (const l of clock.listeners) l();
    }, intervalMs);
  }
  return () => {
    clock.listeners.delete(onChange);
    if (clock.listeners.size === 0 && clock.timer) {
      clearInterval(clock.timer);
      clock.timer = null;
    }
  };
}

function snapshot(intervalMs: number): number {
  const clock = clockFor(intervalMs);
  // Without subscribers nothing ticks; refresh a stale value once per interval
  // so the first render after a pause is not hours behind (and stays stable
  // between consecutive reads, as useSyncExternalStore requires).
  if (!clock.timer && Date.now() - clock.now >= intervalMs) clock.now = Date.now();
  return clock.now;
}

/**
 * Current time in epoch ms, re-rendering every `intervalMs`. Returns 0 on the
 * server and during hydration; callers treat 0 as "not known yet".
 */
export function useNow(intervalMs = 1000): number {
  const ms = Math.max(16, Math.floor(intervalMs));
  const sub = useCallback((onChange: () => void) => subscribe(ms, onChange), [ms]);
  const get = useCallback(() => snapshot(ms), [ms]);
  return useSyncExternalStore(sub, get, () => 0);
}
