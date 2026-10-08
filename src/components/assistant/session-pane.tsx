"use client";

import * as React from "react";
import { PanelLeftClose, Plus, Search, SquareTerminal } from "lucide-react";
import { sessionHref } from "@/components/layout/activity";
import { Button, IconButton } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { EmptyState } from "@/components/ui/empty-state";
import { InputGroup } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { SegmentedControl, SegmentedItem } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import type { ActivityPending, ActivityRun } from "@/hooks/use-activity";
import type { RunState } from "@/lib/run-state";
import { filterSessions, groupSessions, type ListActivity, type SessionFilter } from "./session-list";
import { SessionRow } from "./session-row";
import { rowRunState } from "./use-run-state";
import type { SessionSummary } from "./types";

export interface SessionPaneProps {
  sessions: SessionSummary[];
  loaded: boolean;
  activeId: string | null;
  activeState: RunState;
  activeLoopLabel: string | null;
  runs: ActivityRun[];
  pending: ActivityPending[];
  now: number;
  variant: "desktop" | "mobile";
  onNew: () => void;
  onOpen?: (id: string) => void;
  onStop: (s: SessionSummary) => void;
  onDelete: (s: SessionSummary) => void;
  onCollapse?: () => void;
  /** Visible order (for J/K). */
  onOrder?: (ids: string[]) => void;
  className?: string;
}

export function SessionPane({
  sessions,
  loaded,
  activeId,
  activeState,
  activeLoopLabel,
  runs,
  pending,
  now,
  variant,
  onNew,
  onOpen,
  onStop,
  onDelete,
  onCollapse,
  onOrder,
  className,
}: SessionPaneProps) {
  const [filter, setFilter] = React.useState<SessionFilter>("all");
  const [query, setQuery] = React.useState("");
  const activity = React.useMemo<ListActivity>(
    () => ({ active: new Set(runs.map((r) => r.sessionId)), waiting: new Set(pending.map((p) => p.sessionId)) }),
    [runs, pending],
  );
  const activeCount = sessions.filter((s) => activity.active.has(s.id) || activity.waiting.has(s.id) || s.status === "running").length;
  const waitingCount = sessions.filter((s) => activity.waiting.has(s.id)).length;
  const visible = React.useMemo(() => filterSessions(sessions, filter, query, activity), [sessions, filter, query, activity]);
  // Group by day only when the clock moves on by minutes, not every second.
  const minute = Math.floor(now / 60_000);
  const groups = React.useMemo(() => groupSessions(visible, activity, minute * 60_000), [visible, activity, minute]);

  const order = React.useMemo(() => groups.flatMap((g) => g.sessions.map((s) => s.id)), [groups]);
  React.useEffect(() => {
    onOrder?.(order);
  }, [order, onOrder]);

  const mobile = variant === "mobile";
  const runBy = React.useMemo(() => new Map(runs.map((r) => [r.sessionId, r])), [runs]);
  const pendingBy = React.useMemo(() => {
    const m = new Map<string, ActivityPending[]>();
    for (const p of pending) m.set(p.sessionId, [...(m.get(p.sessionId) ?? []), p]);
    return m;
  }, [pending]);

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      {!mobile ? (
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border pl-4 pr-2">
          <h2 className="text-ui font-semibold">Sessions</h2>
          <span className="text-xs tabular-nums text-subtle-foreground">{sessions.length}</span>
          <span className="flex-1" />
          <Button size="sm" variant="outline" onClick={onNew} kbd="N">
            <Plus aria-hidden />
            Neu
          </Button>
          {onCollapse ? (
            <IconButton aria-label="Sessionliste einklappen" size="icon-sm" tooltip="Sessionliste ein/aus (⌘\ oder Strg+ß)" onClick={onCollapse}>
              <PanelLeftClose />
            </IconButton>
          ) : null}
        </div>
      ) : null}
      {sessions.length > 0 ? (
        <div className={cn("shrink-0 space-y-2 px-3 pt-3", mobile && "px-4")}>
          <SegmentedControl aria-label="Filter" stretch value={filter} onValueChange={(v) => setFilter(v as SessionFilter)}>
            <SegmentedItem value="all">Alle</SegmentedItem>
            <SegmentedItem value="active">
              Aktiv <span className="tabular-nums text-subtle-foreground">{activeCount}</span>
            </SegmentedItem>
            <SegmentedItem value="waiting">
              Wartet <span className={cn("tabular-nums", waitingCount ? "text-warning" : "text-subtle-foreground")}>{waitingCount}</span>
            </SegmentedItem>
          </SegmentedControl>
          {sessions.length > 5 ? (
            <InputGroup
              size="sm"
              leading={<Search />}
              placeholder="Sessions durchsuchen"
              aria-label="Sessions durchsuchen"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          ) : null}
        </div>
      ) : null}
      <nav aria-label="Sessions" className={cn("min-h-0 flex-1 overflow-y-auto px-2 pb-4 pt-1", mobile && "px-3")}>
        {!loaded ? (
          <div className="space-y-2 p-2" aria-label="Sessions werden geladen">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex gap-2.5 py-2">
                <Skeleton className="size-4 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <EmptyState
            icon={<SquareTerminal />}
            title="Noch keine Session"
            description="Starte einen Agenten in einem Projektordner."
            action={
              <Button variant="primary" onClick={onNew}>
                <Plus aria-hidden />
                Neue Session
              </Button>
            }
          >
            {!mobile ? (
              <p className="mt-3 text-xs text-subtle-foreground">
                Tipp: <Kbd>N</Kbd>
              </p>
            ) : null}
          </EmptyState>
        ) : groups.length === 0 ? (
          <p className="px-3 py-6 text-center text-ui text-muted-foreground">Keine passende Session.</p>
        ) : (
          groups.map((g) => (
            <section key={g.id} aria-labelledby={`sg-${g.id}`} className="mt-2">
              {React.createElement(
                mobile ? "h2" : "h3",
                { id: `sg-${g.id}`, className: "px-2.5 pb-1 pt-2 text-xs font-medium text-subtle-foreground" },
                g.label,
              )}
              <ul className="space-y-0.5">
                {g.sessions.map((s) => {
                  const p = pendingBy.get(s.id) ?? [];
                  const run = runBy.get(s.id);
                  const state = rowRunState(s, run, p, { id: activeId, state: activeState }, now);
                  return (
                    <SessionRow
                      key={s.id}
                      session={s}
                      state={state}
                      run={run}
                      pending={p}
                      loopLabel={s.id === activeId ? activeLoopLabel : null}
                      selected={!mobile && s.id === activeId}
                      now={minute * 60_000}
                      onOpen={onOpen}
                      onStop={onStop}
                      onDelete={onDelete}
                      href={sessionHref(s.id)}
                      replace={!mobile}
                    />
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </nav>
    </div>
  );
}
