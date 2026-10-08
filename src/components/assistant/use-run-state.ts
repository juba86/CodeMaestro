"use client";

// Run state of the open session and of the rows in the session list, in the
// one vocabulary of @/lib/run-state (DESIGN.md §4, §6.2.9).
import { useEffect, useMemo, useState } from "react";
import { deriveRunState, type ConnectionOverlay, type RunState } from "@/lib/run-state";
import type { ActivityPending, ActivityRun } from "@/hooks/use-activity";
import { pendingCards, type LiveState } from "./run-events";
import type { ConnectionInfo } from "./use-session-run";
import type { SessionSummary } from "./types";

export interface ActiveRunState {
  state: RunState;
  overlay: ConnectionOverlay;
  /** „Wieder verbunden" is shown for 2s after a reconnect. */
  recovered: boolean;
  online: boolean;
}

/** Browser online state (navigator.onLine + events). */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

export function useActiveRunState(opts: {
  live: LiveState;
  running: boolean;
  stopping: boolean;
  connection: ConnectionInfo;
  sessionStatus?: string;
  /** The activity poll reaches the server. */
  reachable: boolean;
  now: number;
}): ActiveRunState {
  const { live, running, stopping, connection, sessionStatus, reachable, now } = opts;
  const browserOnline = useOnline();
  const online = browserOnline && reachable;

  // „Wieder verbunden" for ~2s after a reconnect (no toast, §6.2.9).
  const recovered = connection.recoveredAt !== null && now - connection.recoveredAt < 2500;

  const pending = useMemo(() => pendingCards(live), [live]);
  // Re-syncs gave up: whether the run still goes is not known — never keep
  // claiming „Läuft im Hintergrund" (§6.2.9: unknown + „Erneut prüfen").
  const trackable = running && !connection.stale;
  const { state, overlay } = deriveRunState({
    // Running before run_start arrived (start POST in flight): a run all the same.
    run: trackable ? live.run ?? { kind: "turn", origin: "pwa", startedAt: now } : null,
    pending,
    loopResumeAt: live.loop?.resumeAt ?? null,
    stopping,
    attached: connection.attached,
    lastEnd: live.ended ? { status: live.ended.status, at: live.ended.at, error: live.ended.error } : null,
    sessionStatus: running ? undefined : sessionStatus,
    stale: connection.stale,
    connection: !online ? "offline" : connection.reconnecting ? "reconnecting" : "live",
    now,
  });
  return { state, overlay, recovered: recovered && !connection.reconnecting, online };
}

/** State of a session-list row from the activity poll and the sessions list. */
export function rowRunState(
  s: SessionSummary,
  run: ActivityRun | undefined,
  pending: ActivityPending[],
  active: { id: string | null; state: RunState } | null,
  now: number,
): RunState {
  if (active && active.id === s.id) return active.state;
  // The sessions list reports "running" only for live runs (server-checked);
  // the activity poll may lag behind it by a few seconds.
  const live = run
    ? { kind: run.kind, origin: run.origin, startedAt: run.startedAt }
    : s.status === "running"
      ? { kind: "turn" as const, origin: "pwa" as const, startedAt: Date.parse(s.updatedAt) || now }
      : null;
  return deriveRunState({
    run: live,
    pending,
    attached: false,
    sessionStatus: s.status,
    now,
  }).state;
}
