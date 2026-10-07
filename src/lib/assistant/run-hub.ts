// Process-wide run registry for assistant work (single turns, orchestrations,
// loops, Telegram turns). A run lives on the server independently of any HTTP
// request: browsers attach to it over SSE, can disconnect (closed window, mobile
// standby, reload) and re-attach later — every event is replayed from a
// per-run buffer, so the transcript, pending approvals and questions survive.
//
// State is kept on globalThis because Next.js bundles route handlers and the
// instrumentation hook (which auto-starts the Telegram bridge) into separate
// module graphs; a plain module-level Map would silently fork per graph.

export type RunKind = "turn" | "orchestrate" | "loop";
export type RunOrigin = "pwa" | "telegram";
export type RunEndStatus = "idle" | "error" | "stopped";

/** Any JSON-serializable event with a `type` discriminator. */
export interface HubEvent {
  type: string;
  [key: string]: unknown;
}

export interface BufferedEvent {
  seq: number;
  /** Server time the event was published (epoch ms). */
  at: number;
  data: HubEvent;
}

export interface RunInfo {
  runId: string;
  sessionId: string;
  kind: RunKind;
  origin: RunOrigin;
  startedAt: number;
  done: boolean;
  lastSeq: number;
  /** False once old events were dropped from the buffer (very long runs). */
  complete: boolean;
}

interface Run {
  info: RunInfo;
  events: BufferedEvent[];
  listeners: Set<(e: BufferedEvent) => void>;
  // Read-only watchers (e.g. the org chart's live view) — they don't count as
  // "someone is watching" for push notifications.
  observers: WeakSet<(e: BufferedEvent) => void>;
  abort: AbortController;
  finished: Promise<RunEndStatus>;
  resolveFinished: (s: RunEndStatus) => void;
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

interface HubState {
  runs: Map<string, Run>; // keyed by sessionId — at most one run per session
  counter: number;
  lastTs: number;
}

const MAX_EVENTS = 5000;
const MAX_FIELD_CHARS = 16_000;
// Keep a finished run around briefly so a client that attaches right after the
// end still receives the final events instead of a bare "idle".
const RETAIN_FINISHED_MS = 60_000;

const g = globalThis as unknown as { __cmRunHub?: HubState };
function hub(): HubState {
  if (!g.__cmRunHub) g.__cmRunHub = { runs: new Map(), counter: 0, lastTs: 0 };
  return g.__cmRunHub;
}

/**
 * Strictly increasing millisecond clock shared by everything that writes
 * assistant transcript rows, so `ORDER BY createdAt` is a total order even when
 * several rows are written within the same millisecond.
 */
export function monotonicNow(): number {
  const h = hub();
  h.lastTs = Math.max(Date.now(), h.lastTs + 1);
  return h.lastTs;
}

function clip(data: HubEvent): HubEvent {
  let out = data;
  for (const key of ["content", "plan"] as const) {
    const v = out[key];
    if (typeof v === "string" && v.length > MAX_FIELD_CHARS) {
      out = { ...out, [key]: `${v.slice(0, MAX_FIELD_CHARS)}\n… (gekürzt)` };
    }
  }
  return out;
}

export class SessionBusyError extends Error {
  constructor() {
    super("In dieser Session läuft bereits eine Aufgabe. Bitte erst stoppen.");
    this.name = "SessionBusyError";
  }
}

/** Returns the active (not yet finished) run of a session, if any. */
export function getActiveRun(sessionId: string): RunInfo | null {
  const r = hub().runs.get(sessionId);
  return r && !r.info.done ? { ...r.info } : null;
}

/** Returns the run of a session including a recently finished one. */
export function getRun(sessionId: string): RunInfo | null {
  const r = hub().runs.get(sessionId);
  return r ? { ...r.info } : null;
}

export function isSessionBusy(sessionId: string): boolean {
  return getActiveRun(sessionId) !== null;
}

/** Number of live SSE/bridge listeners attached to a session's run (observers excluded). */
export function listenerCount(sessionId: string): number {
  const run = hub().runs.get(sessionId);
  if (!run) return 0;
  let n = 0;
  for (const l of run.listeners) if (!run.observers.has(l)) n++;
  return n;
}

export interface RunHandle {
  info: RunInfo;
  signal: AbortSignal;
  publish: (e: HubEvent) => void;
  finished: Promise<RunEndStatus>;
}

/**
 * Registers a new run for a session. Throws SessionBusyError when another run
 * is still active. The caller drives the work and must call `endRun`.
 */
export function beginRun(sessionId: string, kind: RunKind, origin: RunOrigin): RunHandle {
  const h = hub();
  const existing = h.runs.get(sessionId);
  if (existing && !existing.info.done) throw new SessionBusyError();
  if (existing?.cleanupTimer) clearTimeout(existing.cleanupTimer);

  h.counter = (h.counter + 1) % 1_000_000;
  let resolveFinished!: (s: RunEndStatus) => void;
  const finished = new Promise<RunEndStatus>((r) => { resolveFinished = r; });
  const run: Run = {
    info: {
      runId: `run_${Date.now().toString(36)}_${h.counter}`,
      sessionId,
      kind,
      origin,
      startedAt: monotonicNow(),
      done: false,
      lastSeq: 0,
      complete: true,
    },
    events: [],
    listeners: new Set(),
    observers: new WeakSet(),
    abort: new AbortController(),
    finished,
    resolveFinished,
  };
  h.runs.set(sessionId, run);
  publish(sessionId, { type: "run_start", runId: run.info.runId, kind, origin, startedAt: run.info.startedAt });
  return {
    info: { ...run.info },
    signal: run.abort.signal,
    publish: (e) => publish(sessionId, e, run.info.runId),
    finished,
  };
}

/**
 * Appends an event to the session's active run and fans it out to listeners.
 * When `runId` is given the event is dropped if that run is no longer current
 * (prevents a stale worker from writing into a newer run).
 */
export function publish(sessionId: string, data: HubEvent, runId?: string): void {
  const run = hub().runs.get(sessionId);
  if (!run || run.info.done) return;
  if (runId && run.info.runId !== runId) return;
  const ev: BufferedEvent = { seq: run.info.lastSeq + 1, at: Date.now(), data: clip(data) };
  run.info.lastSeq = ev.seq;
  run.events.push(ev);
  if (run.events.length > MAX_EVENTS) {
    run.events.splice(0, run.events.length - MAX_EVENTS);
    run.info.complete = false;
  }
  for (const l of run.listeners) {
    try { l(ev); } catch { /* a broken listener must not break the run */ }
  }
}

/** Marks the run finished, emits `run_end`, and schedules buffer cleanup. */
export function endRun(sessionId: string, runId: string, status: RunEndStatus, extra: Record<string, unknown> = {}): void {
  const h = hub();
  const run = h.runs.get(sessionId);
  if (!run || run.info.runId !== runId || run.info.done) return;
  publish(sessionId, { type: "run_end", runId, status, ...extra });
  run.info.done = true;
  run.resolveFinished(status);
  run.cleanupTimer = setTimeout(() => {
    const cur = h.runs.get(sessionId);
    if (cur === run) h.runs.delete(sessionId);
  }, RETAIN_FINISHED_MS);
  // Do not keep the process alive just for the cleanup timer.
  (run.cleanupTimer as { unref?: () => void }).unref?.();
}

/** Signals the run's AbortController (multi-step runs check it between steps). */
export function abortRun(sessionId: string): boolean {
  const run = hub().runs.get(sessionId);
  if (!run || run.info.done) return false;
  run.abort.abort();
  return true;
}

export function wasAborted(sessionId: string, runId: string): boolean {
  const run = hub().runs.get(sessionId);
  return !!run && run.info.runId === runId && run.abort.signal.aborted;
}

/**
 * Subscribes to a session's run. Returns the buffered events after `sinceSeq`
 * (to replay) plus an unsubscribe function, or null when there is no run.
 * Replay and subscription happen synchronously, so no event can fall between.
 */
export function subscribe(
  sessionId: string,
  sinceSeq: number,
  listener: (e: BufferedEvent) => void,
  opts: { observer?: boolean } = {}
): { info: RunInfo; replay: BufferedEvent[]; unsubscribe: () => void } | null {
  const run = hub().runs.get(sessionId);
  if (!run) return null;
  const replay = run.events.filter((e) => e.seq > sinceSeq);
  if (opts.observer) run.observers.add(listener);
  if (!run.info.done) run.listeners.add(listener);
  return {
    info: { ...run.info },
    replay,
    unsubscribe: () => { run.listeners.delete(listener); },
  };
}

// --- SSE transport ------------------------------------------------------------

const HEARTBEAT_MS = 15_000;

/**
 * Streams a session's run as Server-Sent Events: replays everything after
 * `sinceSeq`, then forwards live events until `run_end`, then closes. Frames
 * carry `id:` so EventSource resumes via Last-Event-ID after a network drop.
 * When the session has no run, sends a single `{type:"idle"}` and closes.
 * Closing the connection only detaches the listener — the run keeps going.
 */
export function sseResponse(
  sessionId: string,
  sinceSeq: number,
  signal: AbortSignal,
  expectedRunId?: string,
  opts: { observer?: boolean } = {}
): Response {
  // A resume position only makes sense within the same run: if the client's
  // position belongs to an older run (other run id, or beyond this run's last
  // event), replay the current run from the start instead of skipping it.
  const current = hub().runs.get(sessionId);
  if (current && ((expectedRunId && expectedRunId !== current.info.runId) || sinceSeq > current.info.lastSeq)) {
    sinceSeq = 0;
  }
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const write = (chunk: string) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(chunk)); } catch { close(); }
      };
      // `at` (server publish time) lets late joiners show exact durations.
      const frame = (e: BufferedEvent) => write(`id: ${e.seq}\ndata: ${JSON.stringify({ ...e.data, at: e.at })}\n\n`);
      const close = () => {
        if (closed) return;
        closed = true;
        cleanup();
        try { controller.close(); } catch { /* already closed */ }
      };

      // Tell EventSource to wait a bit before auto-reconnecting.
      write("retry: 2000\n\n");

      const sub = subscribe(sessionId, sinceSeq, (e) => {
        frame(e);
        if (e.data.type === "run_end") close();
      }, opts);
      if (!sub) {
        write(`data: ${JSON.stringify({ type: "idle" })}\n\n`);
        close();
        return;
      }

      const heartbeat = setInterval(() => write(": ping\n\n"), HEARTBEAT_MS);
      const onAbort = () => close();
      signal.addEventListener("abort", onAbort);
      cleanup = () => {
        clearInterval(heartbeat);
        signal.removeEventListener("abort", onAbort);
        sub.unsubscribe();
      };

      for (const e of sub.replay) frame(e);
      if (sub.info.done || sub.replay.some((e) => e.data.type === "run_end")) close();
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable response buffering in reverse proxies (nginx & co.).
      "X-Accel-Buffering": "no",
    },
  });
}
