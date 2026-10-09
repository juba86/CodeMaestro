"use client";

import { useMemo, useSyncExternalStore } from "react";
import type { ActivityPending, ActivityResponse, ActivityRun } from "@/lib/activity";
import { noteServerTime } from "@/lib/server-clock";

export type { ActivityPending, ActivityResponse, ActivityRun };

export interface ActivityCounts {
  /** Sessions with an active run (including ones waiting on a gate). */
  running: number;
  /** Open approvals and questions across all sessions. */
  waiting: number;
}

export interface ActivitySnapshot {
  runs: ActivityRun[];
  pending: ActivityPending[];
  counts: ActivityCounts;
  /** False after two failed polls in a row, or right away when the device is offline. */
  reachable: boolean;
  /** True until the first poll finished (successfully or not). */
  loading: boolean;
}

export interface UseActivityResult extends ActivitySnapshot {
  /** Polls now (e.g. right after deciding an approval). */
  refresh: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Module-level store: one poller shared by every subscriber (DESIGN.md §4.4).
// ---------------------------------------------------------------------------

const ENDPOINT = "/api/assistant/activity";
const POLL_MS = 5_000;
const BACKOFF_MS = [5_000, 15_000, 30_000];
const REQUEST_TIMEOUT_MS = 10_000;
const UNREACHABLE_AFTER = 2;
// Keep polling briefly after the last subscriber leaves so route changes and
// StrictMode's double mount do not restart the poller.
const STOP_DELAY_MS = 1_000;

const EMPTY_RUNS: ActivityRun[] = [];
const EMPTY_PENDING: ActivityPending[] = [];

const INITIAL: ActivitySnapshot = Object.freeze({
  runs: EMPTY_RUNS,
  pending: EMPTY_PENDING,
  counts: Object.freeze({ running: 0, waiting: 0 }),
  reachable: true,
  loading: true,
});

let state: ActivitySnapshot = INITIAL;
const listeners = new Set<() => void>();

let failures = 0;
let generation = 0;
let inflight: AbortController | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let stopTimer: ReturnType<typeof setTimeout> | null = null;
let started = false;

function setState(patch: Partial<ActivitySnapshot>) {
  const next = { ...state, ...patch };
  const changed = (Object.keys(patch) as (keyof ActivitySnapshot)[]).some((k) => !Object.is(next[k], state[k]));
  if (!changed) return;
  state = next;
  for (const l of listeners) l();
}

const isVisible = () => typeof document === "undefined" || document.visibilityState === "visible";
const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

function clearTimer() {
  if (timer) clearTimeout(timer);
  timer = null;
}

function schedule(ms: number) {
  clearTimer();
  if (!started || !isVisible()) return; // resumed by visibilitychange / online
  timer = setTimeout(() => {
    timer = null;
    if (isVisible()) void poll();
  }, ms);
}

/** Reuses the previous array when the content did not change (stable references). */
function share<T>(prev: T[], next: T[]): T[] {
  if (prev.length === 0 && next.length === 0) return prev;
  return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
}

function isActivityResponse(v: unknown): v is ActivityResponse {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return Array.isArray(r.runs) && Array.isArray(r.pending);
}

function fail() {
  failures++;
  setState({
    loading: false,
    reachable: isOffline() ? false : failures < UNREACHABLE_AFTER && state.reachable,
  });
  schedule(BACKOFF_MS[Math.min(failures, BACKOFF_MS.length) - 1]);
}

async function poll(): Promise<void> {
  clearTimer();
  inflight?.abort();
  const gen = ++generation;

  if (isOffline()) {
    inflight = null;
    fail();
    return;
  }

  const ctrl = new AbortController();
  inflight = ctrl;
  const timeout = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  let data: ActivityResponse;
  // Round trip of the request: `serverTime` was stamped in between (see server-clock).
  const sentAt = Date.now();
  let receivedAt = sentAt;
  try {
    const res = await fetch(ENDPOINT, { cache: "no-store", signal: ctrl.signal });
    receivedAt = Date.now(); // headers are in; the body was built before them
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body: unknown = await res.json();
    if (!isActivityResponse(body)) throw new Error("Unexpected activity payload");
    data = body;
  } catch {
    clearTimeout(timeout);
    if (gen !== generation) return; // superseded by a newer poll or stopped
    inflight = null;
    fail();
    return;
  }
  clearTimeout(timeout);
  // Valid even when superseded: keeps server-stamped deadlines (approval
  // countdowns) correct on devices whose clock is off.
  noteServerTime(data.serverTime, sentAt, receivedAt);
  if (gen !== generation) return;
  inflight = null;

  failures = 0;
  const runs = share(state.runs, data.runs);
  const pending = share(state.pending, data.pending);
  const counts =
    state.counts.running === runs.length && state.counts.waiting === pending.length
      ? state.counts
      : { running: runs.length, waiting: pending.length };
  // No per-poll timestamp in the snapshot: when runs, pending and counts keep
  // their references, setState() is a no-op and no subscriber re-renders.
  setState({ runs, pending, counts, reachable: true, loading: false });
  schedule(POLL_MS);
}

function onVisibilityChange() {
  if (isVisible()) void poll();
  else clearTimer();
}

function onOnline() {
  void poll();
}

function onOffline() {
  setState({ reachable: false });
}

function start() {
  if (started) return;
  started = true;
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  if (isOffline()) setState({ reachable: false });
  if (isVisible()) void poll();
}

function stop() {
  if (!started) return;
  started = false;
  document.removeEventListener("visibilitychange", onVisibilityChange);
  window.removeEventListener("online", onOnline);
  window.removeEventListener("offline", onOffline);
  clearTimer();
  generation++; // drop the answer of a request still in flight
  inflight?.abort();
  inflight = null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (stopTimer) {
    clearTimeout(stopTimer);
    stopTimer = null;
  }
  start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && !stopTimer) {
      stopTimer = setTimeout(() => {
        stopTimer = null;
        if (listeners.size === 0) stop();
      }, STOP_DELAY_MS);
    }
  };
}

const getSnapshot = () => state;
const getServerSnapshot = () => INITIAL;
const getRuns = () => state.runs;
const getPending = () => state.pending;
const getServerRuns = () => EMPTY_RUNS;
const getServerPending = () => EMPTY_PENDING;

/** Polls now. Safe to call from anywhere on the client; also works without subscribers (one-off). */
export function refreshActivity(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  return poll();
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * App-wide activity: running sessions and open gates, polled every 5s while
 * the page is visible (refreshes on focus/online, backs off 5s → 15s → 30s on
 * failures). One poller is shared across all components.
 */
export function useActivity(): UseActivityResult {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return useMemo(() => ({ ...snap, refresh: refreshActivity }), [snap]);
}

/** Open approvals/questions of one session, soonest expiry first. */
export function usePendingFor(sessionId: string | null | undefined): ActivityPending[] {
  const pending = useSyncExternalStore(subscribe, getPending, getServerPending);
  return useMemo(
    () => (sessionId ? pending.filter((p) => p.sessionId === sessionId) : EMPTY_PENDING),
    [pending, sessionId]
  );
}

/** The active run of one session, or null. */
export function useRunFor(sessionId: string | null | undefined): ActivityRun | null {
  const runs = useSyncExternalStore(subscribe, getRuns, getServerRuns);
  return useMemo(() => (sessionId ? runs.find((r) => r.sessionId === sessionId) ?? null : null), [runs, sessionId]);
}
