"use client";

import { AudioWaveform, ChevronRight, UserRound } from "lucide-react";
import type { OrchestraConfig } from "@/lib/assistant/orchestra-types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { useNow } from "@/hooks/use-now";
import { roleAssignment } from "./derive";
import { deriveLiveView, type LiveRoleView, type LiveTone, type OrchestraLiveState } from "./live";
import { RoleIcon } from "./role-chip";
import { useOrchestraConfig } from "./use-orchestra-config";

export const LIVE_TONE_BADGE: Record<LiveTone, "brand" | "neutral" | "success" | "warning" | "danger"> = {
  brand: "brand",
  neutral: "neutral",
  success: "success",
  warning: "warning",
  danger: "danger",
};

export interface OrchestraLiveListProps {
  live: OrchestraLiveState;
  /** The configuration the run uses; defaults to the saved one. */
  config?: OrchestraConfig | null;
  /** Denser rows (assistant inspector, mobile details sheet). */
  compact?: boolean;
  /** Rows become buttons that report the role's current (or last) subtask. */
  onSelectSubtask?: (subtaskId: string) => void;
  className?: string;
}

/** Status badge with a breathing dot while working (static under reduced motion). */
export function LiveBadge({ label, tone, active, srLabel }: { label: string; tone: LiveTone; active?: boolean; srLabel?: string }) {
  return (
    <Badge variant={LIVE_TONE_BADGE[tone]} className="tabular-nums">
      {active ? <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current motion-safe:animate-breathe" /> : null}
      {srLabel && srLabel !== label ? (
        <>
          <span aria-hidden>{label}</span>
          <span className="sr-only">{srLabel}</span>
        </>
      ) : (
        label
      )}
    </Badge>
  );
}

/**
 * Vertical live view of an orchestrator run (§6.3.8): the Dirigent, then one
 * row per role with its state, model, current subtask and review round.
 */
export function OrchestraLiveList({ live, config, compact = false, onSelectSubtask, className }: OrchestraLiveListProps) {
  const shared = useOrchestraConfig();
  const cfg = config === undefined ? shared.config : config;
  const now = useNow(live.active ? 1000 : 60_000);
  const view = deriveLiveView(live, cfg, now);
  const planned = new Set(view.order);
  const unplanned = live.subtasks.length
    ? (cfg?.roles ?? []).filter((r) => r.enabled && !planned.has(r.id)).map((r) => r.name.trim() || r.id)
    : [];

  const rowPad = compact ? "px-2.5 py-2" : "px-3 py-2.5";

  const modelOf = (v: LiveRoleView): string | undefined => {
    if (v.workerLabel) return v.workerLabel;
    const role = v.roleId ? cfg?.roles.find((r) => r.id === v.roleId) : undefined;
    if (!role || !cfg) return undefined;
    return roleAssignment(role, cfg, shared.workers).label;
  };

  const renderRow = (v: LiveRoleView) => {
    const model = modelOf(v);
    const meta = [model, v.detail, v.progress].filter(Boolean).join(" · ");
    const body = (
      <>
        <span
          aria-hidden
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-md [&_svg]:size-4",
            v.active ? "bg-primary-subtle text-primary-text" : "bg-surface-2 text-subtle-foreground",
          )}
        >
          {v.roleId ? <RoleIcon of={{ id: v.roleId, name: v.name }} /> : <UserRound aria-hidden />}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className={cn("truncate font-medium text-foreground", compact ? "text-ui" : "text-sm md:text-ui")}>{v.name}</span>
            <LiveBadge label={v.label} tone={v.tone} active={v.active} />
          </span>
          {meta ? <span className="truncate text-xs text-muted-foreground">{meta}</span> : null}
        </span>
        {onSelectSubtask && v.subtaskId ? <ChevronRight aria-hidden className="size-4 shrink-0 text-subtle-foreground" /> : null}
      </>
    );
    const rowClass = cn(
      "relative flex w-full min-w-0 items-center gap-2.5 text-left",
      rowPad,
      v.active && "bg-primary-subtle",
    );
    return (
      <li key={v.key}>
        {onSelectSubtask && v.subtaskId ? (
          <button
            type="button"
            onClick={() => onSelectSubtask(v.subtaskId!)}
            className={cn(
              rowClass,
              "min-h-11 hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring md:min-h-0",
            )}
            aria-label={`${v.name}: ${v.label}${v.detail ? ` – ${v.detail}` : ""}. Zur Teilaufgabe springen`}
          >
            {body}
          </button>
        ) : (
          <div className={rowClass}>{body}</div>
        )}
      </li>
    );
  };

  const empty = live.phase === "idle" && !live.subtasks.length;

  return (
    <div data-slot="orchestra-live-list" className={cn("overflow-hidden rounded-lg border border-border bg-card", className)}>
      <ul role="list" aria-label="Orchester-Lauf" className="divide-y divide-border">
        <li className={cn("flex min-w-0 items-center gap-2.5", rowPad, view.conductor.active && "bg-primary-subtle")}>
          <span
            aria-hidden
            className="grid size-7 shrink-0 place-items-center rounded-md bg-primary-subtle text-primary-text [&_svg]:size-4"
          >
            <AudioWaveform />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex min-w-0 items-center gap-2">
              <span className={cn("truncate font-medium text-foreground", compact ? "text-ui" : "text-sm md:text-ui")}>Dirigent</span>
              {empty ? null : <LiveBadge label={view.conductor.label} tone={view.conductor.tone} active={view.conductor.active} />}
            </span>
            {empty ? (
              <span className="text-xs text-muted-foreground">Noch kein Orchester-Lauf.</span>
            ) : live.phase === "planning" && !live.subtasks.length ? (
              <span className="text-xs text-muted-foreground">Teilaufgaben folgen …</span>
            ) : live.error ? (
              <span className="line-clamp-2 text-xs text-danger">{live.error}</span>
            ) : null}
          </span>
        </li>
        {view.order.map((id) => renderRow(view.roles[id]))}
        {view.unassigned.map(renderRow)}
      </ul>
      {unplanned.length ? (
        <p className={cn("border-t border-border text-xs text-subtle-foreground", rowPad)}>
          Nicht eingeplant: {unplanned.join(", ")}
        </p>
      ) : null}
    </div>
  );
}
