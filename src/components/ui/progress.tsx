import type * as React from "react";
import { cn } from "./cn";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export type ProgressProps = Omit<React.ComponentProps<"div">, "children"> & {
  value: number;
  max?: number;
  /** Accessible name, e.g. "Loop-Fortschritt". */
  label?: string;
  /** Spoken value, e.g. "Iteration 4 von 10". */
  valueText?: string;
  tone?: "brand" | "success" | "warning" | "danger";
};

const FILL = { brand: "bg-primary", success: "bg-success", warning: "bg-warning", danger: "bg-danger" } as const;

export function Progress({ value, max = 100, label, valueText, tone = "brand", className, ...props }: ProgressProps) {
  const safeMax = max > 0 ? max : 1;
  const v = clamp(Number.isFinite(value) ? value : 0, 0, safeMax);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={v}
      aria-valuetext={valueText}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-border", className)}
      {...props}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-300", FILL[tone])}
        style={{ width: `${(v / safeMax) * 100}%` }}
      />
    </div>
  );
}

export type SegmentState = "done" | "current" | "waiting" | "failed" | "pending" | "paused";

const SEGMENT: Record<SegmentState, string> = {
  done: "bg-success",
  current: "bg-primary motion-safe:animate-breathe",
  waiting: "bg-warning",
  failed: "bg-danger",
  pending: "bg-border-strong",
  paused: "bg-primary/45",
};

/** Above this many segments a plain bar plus "n/m" text is shown instead. */
export const MAX_SEGMENTS = 20;

/**
 * Per-step progress (loop iterations, subtasks). The current position is the
 * first non-finished segment; screen readers get `valueText` (defaults to
 * "Schritt 4 von 10" — pass "Iteration 4 von 10" for loops).
 */
export function SegmentedProgress({
  segments,
  label,
  valueText,
  unit = "Schritt",
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  segments: SegmentState[];
  label?: string;
  valueText?: string;
  /** Word used in the default valueText ("Iteration", "Teilaufgabe"). */
  unit?: string;
}) {
  const total = segments.length;
  const finished = segments.filter((s) => s === "done" || s === "failed").length;
  const activeIdx = segments.findIndex((s) => s === "current" || s === "waiting" || s === "paused");
  const position = activeIdx >= 0 ? activeIdx + 1 : finished;
  const text = valueText ?? `${unit} ${position} von ${total}`;

  if (total > MAX_SEGMENTS) {
    return (
      <div className={cn("flex min-w-0 items-center gap-2", className)} {...props}>
        <Progress value={finished} max={total} label={label} valueText={text} className="min-w-12 flex-1" />
        <span aria-hidden className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {position}/{total}
        </span>
      </div>
    );
  }

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={position}
      aria-valuetext={text}
      className={cn("flex min-w-0 items-center gap-1", className)}
      {...props}
    >
      {segments.map((s, i) => (
        <span
          key={i}
          className={cn(
            "h-1.5 min-w-1.5 max-w-6 flex-1 rounded-full",
            SEGMENT[s],
            (s === "current" || s === "waiting") && "h-2 max-w-7 ring-2 ring-primary-subtle",
          )}
        />
      ))}
    </div>
  );
}
