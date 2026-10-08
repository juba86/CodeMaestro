"use client";

import * as React from "react";
import { CircleCheck, Network, RefreshCw, Repeat, SquareTerminal, WifiOff } from "lucide-react";
import type { OrchestraLiveState } from "@/components/orchestra";
import { Button } from "@/components/ui/button";
import { SweepBar } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { SegmentedProgress, type SegmentState } from "@/components/ui/progress";
import { formatClock, formatDuration } from "@/lib/format";
import { RUN_STATE_META, isWaiting, type ConnectionOverlay, type RunState } from "@/lib/run-state";
import type { LoopProgress } from "./run-events";
import type { RunMeta } from "./types";

export interface RunBarProps {
  run: RunMeta | null;
  state: RunState;
  overlay: ConnectionOverlay;
  recovered: boolean;
  attempt: number;
  loop: LoopProgress | null;
  /** Completion signal of the running loop („Ende bei DONE"). */
  signal?: string;
  orch: OrchestraLiveState;
  now: number;
  /** Hybrid planning is in flight (no run yet). */
  planning: boolean;
  onRecheck: () => void;
}

function loopSegments(loop: LoopProgress, state: RunState): SegmentState[] {
  const out: SegmentState[] = [];
  for (let i = 1; i <= loop.maxIterations; i++) {
    if (i < loop.iteration) out.push("done");
    else if (i === loop.iteration) out.push(isWaiting(state) ? "waiting" : state === "loop_paused" ? "paused" : "current");
    else out.push("pending");
  }
  return out;
}

/** Run bar (DESIGN.md §6.2.9): what runs, progress, elapsed, and the connection overlay. */
export function RunBar({ run, state, overlay, recovered, attempt, loop, signal, orch, now, planning, onRecheck }: RunBarProps) {
  const unknown = state === "unknown";
  if (!run && !overlay && !recovered && !unknown && !planning) return null;

  const elapsed = run && now > run.startedAt ? formatDuration(now - run.startedAt) : null;
  const kind = run?.kind ?? (planning ? "orchestrate" : "turn");
  const Icon = kind === "loop" ? Repeat : kind === "orchestrate" ? Network : SquareTerminal;
  const done = orch.subtasks.filter((s) => s.status === "done").length;

  let main: React.ReactNode = null;
  if (planning && !run) {
    main = (
      <>
        <span className="font-medium">Orchester</span>
        <span className="truncate text-muted-foreground">Dirigent plant …</span>
      </>
    );
  } else if (run && kind === "loop") {
    main = (
      <>
        <span className="font-medium">Loop</span>
        {loop ? (
          <span className="shrink-0 tabular-nums text-muted-foreground">
            Iteration <span className="font-semibold text-foreground">{loop.iteration}</span>/{loop.maxIterations}
          </span>
        ) : null}
        {loop && loop.maxIterations > 0 ? (
          <SegmentedProgress
            segments={loopSegments(loop, state)}
            label="Loop-Fortschritt"
            valueText={`Iteration ${loop.iteration} von ${loop.maxIterations}`}
            className="min-w-16 max-w-72 flex-1"
          />
        ) : null}
        {state === "loop_paused" && loop?.resumeAt ? (
          <span className="truncate text-muted-foreground">weiter um {formatClock(loop.resumeAt)}</span>
        ) : signal ? (
          <span className="hidden shrink-0 text-muted-foreground lg:inline">
            Ende bei <span className="rounded-sm border border-border-strong bg-surface-2 px-1 font-mono text-xs text-foreground">{signal}</span>
          </span>
        ) : null}
      </>
    );
  } else if (run && kind === "orchestrate") {
    main = (
      <>
        <span className="font-medium">Orchester</span>
        <span className="truncate tabular-nums text-muted-foreground">
          {orch.subtasks.length ? `${done}/${orch.subtasks.length} Teilaufgaben` : orch.phase === "synthesizing" ? "fasst zusammen …" : "Dirigent plant …"}
        </span>
      </>
    );
  } else if (run) {
    main = <span className="truncate font-medium">{RUN_STATE_META[state].label}</span>;
  } else if (unknown) {
    main = <span className="truncate font-medium">{RUN_STATE_META.unknown.label}</span>;
  }

  return (
    <div
      className={cn(
        "relative flex h-10 shrink-0 items-center gap-3 border-b border-border bg-surface px-4 text-ui md:px-6",
        overlay === "reconnecting" && "border-dashed border-b-warning-border",
      )}
    >
      {run || planning ? <Icon aria-hidden className="size-4 shrink-0 text-primary-text" /> : null}
      <div className="flex min-w-0 flex-1 items-center gap-3">{main}</div>
      {overlay === "reconnecting" ? (
        <span className="inline-flex min-w-0 items-center gap-1.5 text-warning" role="status">
          <RefreshCw aria-hidden className="size-3.5 shrink-0 motion-safe:animate-spin" />
          <span className="truncate">
            Verbindung unterbrochen – wird wiederhergestellt …
            {/* The attempt counter is visual only: the status is announced once, not on every retry. */}
            {attempt > 1 ? (
              <span aria-hidden className="tabular-nums">
                {" "}
                (Versuch {attempt})
              </span>
            ) : null}
          </span>
        </span>
      ) : overlay === "offline" ? (
        <span className="inline-flex min-w-0 items-center gap-1.5 text-warning" role="status">
          <WifiOff aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">Offline – Anzeige kann veraltet sein</span>
        </span>
      ) : recovered ? (
        <span className="inline-flex items-center gap-1.5 text-success" role="status">
          <CircleCheck aria-hidden className="size-3.5" />
          Wieder verbunden
        </span>
      ) : null}
      {unknown ? (
        <Button size="sm" variant="outline" onClick={onRecheck}>
          <RefreshCw aria-hidden />
          Erneut prüfen
        </Button>
      ) : null}
      {elapsed && !overlay ? <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{elapsed}</span> : null}
      {state === "running" ? <SweepBar /> : null}
    </div>
  );
}
