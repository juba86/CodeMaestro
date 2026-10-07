"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { toast } from "sonner";
import { EMPTY_LIVE, liveReducer } from "./run-events";
import type { ApprovalEvent, Msg, RunEvent, SessionPayload } from "./types";

// Work runs server-side in a run hub; this hook only *follows* it. One
// EventSource per page (always closed before a new one opens) attaches to the
// active session's run, replays everything since the given sequence number and
// streams live until `run_end`. Closing the window, mobile standby, a network
// drop or a reload therefore never loses work, cards or running state —
// re-opening the session re-attaches.
//
// While the page is hidden the stream is released on purpose: the server only
// sends push notifications (approvals, questions, run end) when nobody is
// attached, and a backgrounded tab/PWA is not watching. Becoming visible again
// resumes from the last seen event.

const STORAGE_KEY = "cm-assistant-session";
const RETRY_DELAYS_MS = [1000, 2000, 5000, 10000];
const STOP_FALLBACK_MS = 15_000;
/** Events are folded in batches (one render per batch, not per SSE frame). */
const FLUSH_MS = 40;
/**
 * Sleep detector: a timer that fires much later than scheduled means the
 * device was suspended — the socket may be half-open (OPEN but dead), and SSE
 * heartbeats are invisible to EventSource, so the stream is re-established.
 */
const WATCHDOG_MS = 10_000;
const SLEPT_AFTER_MS = 30_000;

export type StartResult = { ok: true } | { ok: false; status: number };

const sessionUrl = (sid: string) => `/api/assistant/sessions/${encodeURIComponent(sid)}`;

const pageHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

/** Last opened session (deep links win over this; see the view). */
export function storedSessionId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Persists the active session in localStorage and in the URL (?session=). */
function rememberSession(sid: string | null) {
  try {
    if (sid) localStorage.setItem(STORAGE_KEY, sid);
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* storage unavailable (private mode) */ }
  try {
    const url = new URL(window.location.href);
    if (sid) url.searchParams.set("session", sid);
    else url.searchParams.delete("session");
    if (url.href !== window.location.href) window.history.replaceState(null, "", url);
  } catch { /* ignore */ }
}

/** GET the session: payload, "missing" on 404, or null on any other failure. */
async function fetchSession(sid: string): Promise<SessionPayload | "missing" | null> {
  try {
    const res = await fetch(sessionUrl(sid), { cache: "no-store" });
    if (res.status === 404) return "missing";
    if (!res.ok) return null;
    return (await res.json()) as SessionPayload;
  } catch {
    return null;
  }
}

export function useSessionRun(onSessionsChanged: () => void) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [live, dispatch] = useReducer(liveReducer, EMPTY_LIVE);
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  const activeRef = useRef<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  // Bumped by every open/start; async continuations from older ones bail out.
  const openSeq = useRef(0);
  const runIdRef = useRef<string | null>(null);
  const lastSeqRef = useRef(0);
  /** Session whose start POST is in flight (opens/re-attaches wait for it). */
  const startingRef = useRef<string | null>(null);
  const mountedRef = useRef(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCount = useRef(0);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Stop pressed while the start POST was still in flight. */
  const stopAfterStart = useRef<string | null>(null);
  // Events received but not yet folded into `live` (see FLUSH_MS).
  const queue = useRef<RunEvent[]>([]);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const changedRef = useRef(onSessionsChanged);
  // Late-bound openSession (it is referenced by callbacks defined before it).
  const openRef = useRef<(sid: string) => Promise<void>>(async () => {});

  useEffect(() => {
    changedRef.current = onSessionsChanged;
  }, [onSessionsChanged]);

  const flush = useCallback(() => {
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = null;
    const events = queue.current;
    if (events.length === 0) return;
    queue.current = [];
    dispatch({ type: "events", events });
  }, []);

  /**
   * Closes the stream. Queued events are applied first: `lastSeqRef` already
   * counts them, so dropping them would leave a gap on resume.
   */
  const detach = useCallback(() => {
    const es = esRef.current;
    esRef.current = null;
    es?.close();
    flush();
  }, [flush]);

  const clearRetry = useCallback(() => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
  }, []);

  const clearTimers = useCallback(() => {
    clearRetry();
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopTimer.current = null;
  }, [clearRetry]);

  /** Re-open the active session after a failure, with backoff (1s→2s→5s→10s). */
  const scheduleResync = useCallback(() => {
    if (retryTimer.current) return;
    setReconnecting(true);
    const delay = RETRY_DELAYS_MS[Math.min(retryCount.current, RETRY_DELAYS_MS.length - 1)];
    retryCount.current += 1;
    retryTimer.current = setTimeout(() => {
      retryTimer.current = null;
      const sid = activeRef.current;
      // Hidden pages re-sync when they become visible again.
      if (sid && mountedRef.current && !pageHidden()) void openRef.current(sid);
    }, delay);
  }, []);

  const forget = useCallback(() => {
    detach();
    activeRef.current = null;
    runIdRef.current = null;
    lastSeqRef.current = 0;
    rememberSession(null);
    setActiveId(null);
    setMessages([]);
    dispatch({ type: "reset" });
    setRunning(false);
    setStopping(false);
    setReconnecting(false);
  }, [detach]);

  /** Run finished (run_end / idle): reload the persisted transcript, clear live state. */
  const settle = useCallback(async (sid: string) => {
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopTimer.current = null;
    const seq = openSeq.current;
    const d = await fetchSession(sid);
    if (seq !== openSeq.current || activeRef.current !== sid) return;
    runIdRef.current = null;
    lastSeqRef.current = 0;
    if (d === "missing") { forget(); return; }
    if (!d) {
      // Keep what is on screen; the resync reloads the transcript.
      setRunning(false);
      setStopping(false);
      scheduleResync();
      return;
    }
    if (d.run) {
      // Another run already started (e.g. from Telegram) — follow it.
      void openRef.current(sid);
      return;
    }
    setMessages(d.session?.messages ?? []);
    dispatch({ type: "reset" });
    setRunning(false);
    setStopping(false);
    setReconnecting(false);
    changedRef.current();
  }, [forget, scheduleResync]);

  const attach = useCallback((sid: string, since: number) => {
    detach();
    // Hidden: stay detached (push notifications need "nobody watching");
    // the visibility handler re-attaches from lastSeqRef.
    if (!mountedRef.current || pageHidden()) return;
    const es = new EventSource(`${sessionUrl(sid)}/events?since=${since}`);
    esRef.current = es;
    es.onopen = () => {
      if (esRef.current !== es) return;
      retryCount.current = 0;
      setReconnecting(false);
    };
    es.onmessage = (msg: MessageEvent<string>) => {
      if (esRef.current !== es) return;
      let ev: RunEvent;
      try {
        ev = JSON.parse(msg.data) as RunEvent;
      } catch {
        return;
      }
      const seq = Number(msg.lastEventId);
      if (Number.isFinite(seq) && seq > lastSeqRef.current) lastSeqRef.current = seq;
      if (ev.type === "run_end" || ev.type === "idle") {
        // Close ourselves: a server-closed EventSource would auto-reconnect.
        detach();
        if (ev.type === "run_end" && ev.error) toast.error(ev.error);
        void settle(sid);
        return;
      }
      if (ev.type === "run_start") {
        runIdRef.current = ev.runId;
        setRunning(true);
      }
      queue.current.push(ev);
      if (!flushTimer.current) flushTimer.current = setTimeout(flush, FLUSH_MS);
    };
    es.onerror = () => {
      if (esRef.current !== es) return;
      // Never use EventSource's built-in reconnect: its Last-Event-ID is not
      // scoped to a run, so after a long drop it could resume a *newer* run
      // (e.g. started via Telegram) at the old sequence number. Re-sync via
      // the snapshot instead, which checks the runId.
      detach();
      scheduleResync();
    };
  }, [detach, flush, settle, scheduleResync]);

  /** Applies a GET snapshot: transcript + (if a run is active) cards and stream. */
  const applySnapshot = useCallback((sid: string, d: SessionPayload) => {
    const run = d.run ?? null;
    setMessages(d.session?.messages ?? []);
    if (!run) {
      runIdRef.current = null;
      lastSeqRef.current = 0;
      retryCount.current = 0;
      dispatch({ type: "reset" });
      setRunning(false);
      setStopping(false);
      setReconnecting(false);
      return;
    }
    // Same run we already show: continue after the last seen event (no flicker).
    const resume = run.complete && run.runId === runIdRef.current && lastSeqRef.current > 0;
    if (resume) {
      dispatch({ type: "pending", pending: run.pending ?? [] });
    } else {
      runIdRef.current = run.runId;
      lastSeqRef.current = run.attachFrom;
      dispatch({
        type: "seed",
        run: { runId: run.runId, kind: run.kind, origin: run.origin, startedAt: run.startedAt },
        pending: run.pending ?? [],
      });
    }
    setRunning(true);
    attach(sid, lastSeqRef.current);
  }, [attach]);

  /**
   * Opens `sid` (or re-syncs it when it already is the active session).
   * `quiet`: a vanished session is dropped without an error toast.
   */
  const openSession = useCallback(async (sid: string, opts: { quiet?: boolean } = {}) => {
    // A start POST for this session is in flight; it attaches when it returns.
    if (startingRef.current === sid && activeRef.current === sid) return;
    const seq = ++openSeq.current;
    const switching = activeRef.current !== sid;
    detach();
    clearRetry();
    activeRef.current = sid;
    rememberSession(sid);
    if (switching) {
      if (stopTimer.current) clearTimeout(stopTimer.current);
      stopTimer.current = null;
      runIdRef.current = null;
      lastSeqRef.current = 0;
      retryCount.current = 0;
      setActiveId(sid);
      setMessages([]);
      dispatch({ type: "reset" });
      setRunning(false);
      setStopping(false);
      setReconnecting(false);
    }
    const d = await fetchSession(sid);
    if (seq !== openSeq.current) return;
    if (d === "missing") {
      forget();
      if (!opts.quiet) toast.error("Session nicht gefunden.");
      return;
    }
    if (!d) { scheduleResync(); return; }
    applySnapshot(sid, d);
  }, [detach, clearRetry, forget, scheduleResync, applySnapshot]);

  useEffect(() => {
    openRef.current = openSession;
  }, [openSession]);

  /** Opens `sid` unless it already is the active session. */
  const ensureSession = useCallback((sid: string, opts?: { quiet?: boolean }) => {
    if (activeRef.current !== sid) void openSession(sid, opts);
  }, [openSession]);

  /** Re-attach when the stream is missing/closed (or `force`). */
  const reattach = useCallback((force = false) => {
    const sid = activeRef.current;
    if (!sid || startingRef.current === sid || pageHidden()) return;
    const es = esRef.current;
    if (force || !es || es.readyState === EventSource.CLOSED) {
      retryCount.current = 0;
      void openRef.current(sid);
    }
  }, []);

  /** Closes the active session — only if it still is `sid` (when given). */
  const closeSession = useCallback((sid?: string) => {
    if (sid !== undefined && activeRef.current !== sid) return;
    openSeq.current++;
    clearTimers();
    forget();
  }, [clearTimers, forget]);

  /**
   * Stops the run of `sid` (default: the active session). The running state
   * stays until `run_end` arrives; after 15s without it the session is re-synced.
   */
  const stop = useCallback(async (sid?: string) => {
    const target = sid ?? activeRef.current;
    if (!target) return;
    const isActive = target === activeRef.current;
    if (isActive) setStopping(true);
    if (startingRef.current === target) {
      // The run does not exist yet — startRun stops it once the POST returns.
      stopAfterStart.current = target;
      return;
    }
    try {
      await fetch(`${sessionUrl(target)}/stop`, { method: "POST" });
    } catch { /* the fallback below re-syncs */ }
    changedRef.current();
    if (!isActive || activeRef.current !== target) return;
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopTimer.current = null;
    // Not attached (hidden, reconnecting): re-sync now; run_end then settles.
    if (!esRef.current) void openRef.current(target);
    stopTimer.current = setTimeout(() => {
      stopTimer.current = null;
      if (activeRef.current !== target) return;
      setStopping(false);
      void openRef.current(target);
    }, STOP_FALLBACK_MS);
  }, []);

  /**
   * Starts server-side work in `sid` (POST → 202 {runId}) and attaches to it.
   * Refuses when `sid` is no longer the active session (the user switched while
   * the caller was preparing the request). `optimistic` adds the user's prompt
   * as a bubble until the transcript reloads.
   */
  const startRun = useCallback(async (
    sid: string,
    path: string,
    body: object,
    optimistic?: string,
  ): Promise<StartResult> => {
    if (startingRef.current) return { ok: false, status: 0 };
    if (activeRef.current !== sid) {
      toast.info("Session gewechselt — Aufgabe wurde nicht gesendet.");
      return { ok: false, status: 0 };
    }
    openSeq.current++;
    detach();
    clearTimers();
    if (optimistic) setMessages((prev) => [...prev, { role: "user", content: optimistic, local: true }]);
    dispatch({ type: "reset" });
    runIdRef.current = null;
    lastSeqRef.current = 0;
    setRunning(true);
    setStopping(false);

    startingRef.current = sid;
    let res: Response | null = null;
    let d: { runId?: string; error?: string } = {};
    try {
      res = await fetch(`${sessionUrl(sid)}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      d = await res.json().catch(() => ({}));
    } catch {
      res = null;
    } finally {
      startingRef.current = null;
    }
    const stopQueued = stopAfterStart.current === sid;
    if (!res?.ok || activeRef.current !== sid) stopAfterStart.current = null;
    if (activeRef.current !== sid) {
      // Switched away meanwhile: the run (if any) shows up in the session list.
      if (res?.ok && stopQueued) void stop(sid);
      changedRef.current();
      return res?.ok ? { ok: true } : { ok: false, status: res?.status ?? 0 };
    }

    if (res?.ok) {
      // Attach through a fresh snapshot rather than straight from seq 0: it
      // also loads the transcript (with the now persisted prompt) when the send
      // raced the initial load of a just-opened session. The run's events are
      // buffered server-side, so nothing is missed meanwhile.
      runIdRef.current = d.runId ?? null;
      lastSeqRef.current = 0;
      void openSession(sid);
      changedRef.current();
      if (stopAfterStart.current === sid) {
        stopAfterStart.current = null;
        void stop(sid);
      }
      return { ok: true };
    }

    if (optimistic) setMessages((prev) => prev.filter((m) => !m.local));
    setRunning(false);
    setStopping(false);
    if (res?.status === 409) {
      // Someone else (another tab, Telegram) is running this session — follow it.
      toast.error(d.error || "In dieser Session läuft bereits eine Aufgabe.");
      void openRef.current(sid);
    } else {
      toast.error(d.error || (res ? "Anfrage fehlgeschlagen." : "Server nicht erreichbar."));
    }
    return { ok: false, status: res?.status ?? 0 };
  }, [detach, clearTimers, openSession, stop]);

  /** Answers an approval or question card (allow/deny + optional reason). */
  const decide = useCallback(async (card: ApprovalEvent, decision: "allow" | "deny", reason?: string) => {
    const sid = activeRef.current;
    const runId = runIdRef.current;
    dispatch({ type: "dismiss", approvalId: card.approvalId });
    try {
      const res = await fetch(`/api/assistant/approval/${encodeURIComponent(card.approvalId)}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, reason }),
      });
      // 410: expired, or already decided elsewhere (another tab, Telegram).
      if (res.status === 410) toast.warning("Freigabe abgelaufen oder bereits entschieden.");
      else if (!res.ok) throw new Error(String(res.status));
    } catch {
      toast.error("Entscheidung konnte nicht übermittelt werden.");
      // Put the card back so it can be retried — only while the same run is
      // still shown (never into another session or a finished run).
      if (runId && activeRef.current === sid && runIdRef.current === runId) {
        dispatch({ type: "event", event: card });
      }
    }
  }, []);

  // Lifecycle: tear the stream and timers down on unmount.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      detach();
      clearTimers();
    };
  }, [detach, clearTimers]);

  // Release the stream while hidden; re-attach on return / network return /
  // bfcache restore / wake from sleep.
  useEffect(() => {
    let lastTick = Date.now();
    const onVisibility = () => {
      lastTick = Date.now();
      if (document.visibilityState === "hidden") {
        clearRetry();
        detach();
        return;
      }
      reattach();
      changedRef.current();
    };
    // Connections that survived an offline phase are suspect: resume afresh.
    const onOnline = () => reattach(true);
    const watchdog = setInterval(() => {
      const now = Date.now();
      const slept = now - lastTick > SLEPT_AFTER_MS;
      lastTick = now;
      if (slept && esRef.current) reattach(true);
    }, WATCHDOG_MS);
    const onPageHide = () => detach();
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) reattach(true);
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      clearInterval(watchdog);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [reattach, detach, clearRetry]);

  return {
    activeId,
    messages,
    live,
    running,
    stopping,
    reconnecting,
    openSession,
    ensureSession,
    reattach,
    closeSession,
    startRun,
    stop,
    decide,
  };
}
