import type * as React from "react";
import {
  Circle,
  CircleCheck,
  CircleHelp,
  CircleX,
  ListChecks,
  LoaderCircle,
  MessageCircleQuestion,
  RefreshCw,
  Send,
  Server,
  ShieldAlert,
  Square,
  Timer,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { cn } from "./cn";
import {
  CONNECTION_OVERLAY_META,
  RUN_STATE_META,
  type ConnectionOverlay,
  type LucideIconName,
  type RunState,
  type RunTone,
} from "@/lib/run-state";
import { Badge, type BadgeVariant } from "./badge";

export const RUN_STATE_ICONS: Record<LucideIconName, LucideIcon> = {
  Circle,
  LoaderCircle,
  Server,
  Send,
  ShieldAlert,
  MessageCircleQuestion,
  ListChecks,
  Timer,
  Square,
  CircleCheck,
  CircleX,
  CircleHelp,
  RefreshCw,
  WifiOff,
};

/** Tone → Badge variant (DESIGN.md §2.3). */
export const TONE_BADGE: Record<RunTone, BadgeVariant> = {
  brand: "brand",
  warning: "warning",
  info: "info",
  success: "success",
  danger: "danger",
  neutral: "neutral",
};

/** Tone → text colour for icons and inline labels. */
export const TONE_TEXT: Record<RunTone, string> = {
  brand: "text-primary-text",
  warning: "text-warning",
  info: "text-info",
  success: "text-success",
  danger: "text-danger",
  neutral: "text-subtle-foreground",
};

function StateGlyph({ state, className }: { state: RunState; className?: string }) {
  const meta = RUN_STATE_META[state];
  if (state === "running") {
    // The running dot breathes (motion-safe); static otherwise.
    return (
      <span aria-hidden className={cn("grid size-3 shrink-0 place-items-center", className)}>
        <span className="size-2 rounded-full bg-current motion-safe:animate-breathe" />
      </span>
    );
  }
  const Icon = RUN_STATE_ICONS[meta.icon];
  return (
    <Icon
      aria-hidden
      className={cn(
        "shrink-0",
        meta.filled && "fill-current",
        meta.motion === "breathe" && "motion-safe:animate-breathe",
        className,
      )}
    />
  );
}

export type StatusBadgeProps = Omit<React.ComponentProps<"span">, "children"> & {
  state: RunState;
  /** Secondary text after the label, e.g. "4:12" or "weiter um 14:32". */
  detail?: React.ReactNode;
  size?: "sm" | "md";
};

/** Icon + German label + tone for a run state. Never colour alone. */
export function StatusBadge({ state, detail, size = "sm", className, ...props }: StatusBadgeProps) {
  const meta = RUN_STATE_META[state];
  return (
    <Badge
      data-state={state}
      variant={TONE_BADGE[meta.tone]}
      size={size}
      className={cn(meta.dashed && "border-dashed", className)}
      {...props}
    >
      <StateGlyph state={state} className="size-3" />
      <span>{meta.label}</span>
      {detail != null && detail !== "" ? <span className="tabular-nums opacity-90">· {detail}</span> : null}
    </Badge>
  );
}

/** Icon-only state for dense lists. Has role="img" and a German name. */
export function StatusIcon({
  state,
  "aria-label": ariaLabel,
  className,
}: {
  state: RunState;
  "aria-label"?: string;
  className?: string;
}) {
  const meta = RUN_STATE_META[state];
  return (
    <span
      role="img"
      aria-label={ariaLabel ?? meta.label}
      data-state={state}
      className={cn("inline-grid size-4 shrink-0 place-items-center [&_svg]:size-4", TONE_TEXT[meta.tone], className)}
    >
      <StateGlyph state={state} className={state === "running" ? "size-4" : undefined} />
    </span>
  );
}

/** The connection overlay shown next to (never instead of) the state. */
export function ConnectionBadge({
  overlay,
  attempt,
  size = "sm",
  className,
}: {
  overlay: ConnectionOverlay;
  /** Reconnect attempt number („Versuch 2"). */
  attempt?: number;
  size?: "sm" | "md";
  className?: string;
}) {
  if (!overlay) return null;
  const meta = CONNECTION_OVERLAY_META[overlay];
  const Icon = RUN_STATE_ICONS[meta.icon];
  return (
    <Badge variant={TONE_BADGE[meta.tone]} size={size} className={cn(meta.dashed && "border-dashed", className)}>
      <Icon aria-hidden className={cn("size-3", meta.spin && "motion-safe:animate-spin")} />
      <span>{meta.label}</span>
      {overlay === "reconnecting" && attempt && attempt > 1 ? (
        <span className="tabular-nums">(Versuch {attempt})</span>
      ) : null}
    </Badge>
  );
}
