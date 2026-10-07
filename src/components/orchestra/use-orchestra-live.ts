"use client";

// Read-only follower of one session's run for the /orchestra Live view
// (§6.3.8). Same protocol as the assistant (use-session-run.ts): a GET
// snapshot pins the run, then an EventSource replays from `attachFrom`
// (`?run=` keeps a newer run from resuming at an old sequence number). The
// stream is released while the page is hidden — the server sends push
// notifications only when nobody is attached — and resumes on return.

import { useEffect, useReducer } from "react";
import { EMPTY_ORCHESTRA_LIVE, reduceOrchestraLive, type OrchestraLiveState } from "./live";

export type LiveConnection = "idle" | "connecting" | "live" | "reconnecting" | "ended";

interface State {
  sid: string | null;
  live: OrchestraLiveState;
  connection: LiveConnection;
}

type Action =
  | { type: "connection"; sid: string; connection: LiveConnection }
  | { type: "reset"; sid: string }
  | { type: "event"; sid: string; event: { type: string }; at: number };

function reducer(state: State, action: Action): State {
  const base: State = state.sid === action.sid ? state : { sid: action.sid, live: EMPTY_ORCHESTRA_LIVE, connection: "idle" };
  switch (action.type) {
    case "connection":
      return base.connection === action.connection && base === state ? state : { ...base, connection: action.connection };
    case "reset":
      return { ...base, live: EMPTY_ORCHESTRA_LIVE };
    case "event": {
      const live = reduceOrchestraLive(base.live, action.event, action.at);
      return live === base.live && base === state ? state : { ...base, live };
    }
  }
}

const INITIAL: State = { sid: null, live: EMPTY_ORCHESTRA_LIVE, connection: "idle" };
const RETRY_MS = [1000, 2000, 5000, 10_000];

interface RunSnapshot {
  runId: string;
  kind: string;
  origin: string;
  startedAt: number;
  attachFrom: number;
}

export function useOrchestraLive(sessionId: string | null): { live: OrchestraLiveState; connection: LiveConnection } {
  const [state, dispatch] = useReducer(reducer, INITIAL);

  useEffect(() => {
    if (!sessionId) return;
    const sid = sessionId;
    const url = `/api/assistant/sessions/${encodeURIComponent(sid)}`;
    let closed = false;
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let retries = 0;
    let runId: string | null = null;
    let lastSeq = 0;
    let ended = false;

    const hidden = () => document.visibilityState === "hidden";
    const detach = () => {
      es?.close();
      es = null;
    };
    const schedule = () => {
      if (closed || timer) return;
      dispatch({ type: "connection", sid, connection: "reconnecting" });
      const delay = RETRY_MS[Math.min(retries, RETRY_MS.length - 1)];
      retries += 1;
      timer = setTimeout(() => {
        timer = null;
        void open();
      }, delay);
    };

    const attach = (since: number) => {
      detach();
      if (closed || hidden() || !runId) return;
      const source = new EventSource(`${url}/events?since=${since}&run=${encodeURIComponent(runId)}&observer=1`);
      es = source;
      source.onopen = () => {
        if (es !== source) return;
        retries = 0;
        dispatch({ type: "connection", sid, connection: "live" });
      };
      source.onmessage = (msg: MessageEvent<string>) => {
        if (es !== source) return;
        let ev: { type?: unknown };
        try {
          ev = JSON.parse(msg.data) as { type?: unknown };
        } catch {
          return;
        }
        if (typeof ev?.type !== "string") return;
        const seq = Number(msg.lastEventId);
        if (Number.isFinite(seq) && seq > lastSeq) lastSeq = seq;
        if (ev.type === "idle") {
          detach();
          ended = true;
          dispatch({ type: "event", sid, event: { type: "run_end", status: "idle" } as { type: string }, at: Date.now() });
          dispatch({ type: "connection", sid, connection: "ended" });
          return;
        }
        dispatch({ type: "event", sid, event: ev as { type: string }, at: Date.now() });
        if (ev.type === "run_end") {
          // Close ourselves: a server-closed EventSource would reconnect.
          detach();
          ended = true;
          dispatch({ type: "connection", sid, connection: "ended" });
        }
      };
      source.onerror = () => {
        if (es !== source) return;
        detach();
        schedule();
      };
    };

    const open = async () => {
      if (closed || hidden() || ended) return;
      let run: RunSnapshot | null;
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (res.status === 404) {
          ended = true;
          dispatch({ type: "connection", sid, connection: "ended" });
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        run = ((await res.json()) as { run?: RunSnapshot | null }).run ?? null;
      } catch {
        schedule();
        return;
      }
      if (closed) return;
      if (!run) {
        ended = true;
        if (runId) dispatch({ type: "event", sid, event: { type: "run_end", status: "idle" } as { type: string }, at: Date.now() });
        dispatch({ type: "connection", sid, connection: "ended" });
        return;
      }
      if (run.runId !== runId) {
        runId = run.runId;
        lastSeq = run.attachFrom;
        dispatch({ type: "reset", sid });
        // Replays from 0 start with run_start; a trimmed buffer starts later, so seed it.
        if (run.attachFrom > 0) {
          dispatch({
            type: "event",
            sid,
            event: { type: "run_start", runId: run.runId, kind: run.kind, startedAt: run.startedAt } as { type: string },
            at: Date.now(),
          });
        }
      }
      attach(lastSeq);
    };

    const onVisibility = () => {
      if (hidden()) {
        if (timer) clearTimeout(timer);
        timer = null;
        detach();
      } else if (!es && !ended) {
        retries = 0;
        void open();
      }
    };
    const onOnline = () => {
      if (!ended && !hidden()) {
        detach();
        retries = 0;
        void open();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    void open();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      detach();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, [sessionId]);

  if (!sessionId || state.sid !== sessionId) return { live: EMPTY_ORCHESTRA_LIVE, connection: sessionId ? "connecting" : "idle" };
  return { live: state.live, connection: state.connection };
}
