"use client";

import { useNow } from "@/hooks/use-now";
import { cn } from "./cn";

/** "4:32", "1:02:03" */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export type CountdownPhase = "normal" | "soon" | "expired";

export function countdownPhase(remainingMs: number): CountdownPhase {
  if (remainingMs <= 0) return "expired";
  if (remainingMs < 60_000) return "soon";
  return "normal";
}

/** What the polite live region says: only at 60s and at 15s. */
export function countdownAnnouncement(remainingMs: number): string {
  if (remainingMs <= 0) return "";
  if (remainingMs <= 15_000) return "Läuft in 15 Sekunden ab";
  if (remainingMs <= 60_000) return "Läuft in 1 Minute ab";
  return "";
}

const DEFAULT_TOTAL_MS = 30 * 60_000; // server default approval timeout

export type CountdownProps = {
  /** Deadline (epoch ms). */
  expiresAt: number;
  variant?: "ring" | "text";
  /** Prefix before the time; default „läuft ab in". */
  label?: string;
  /** Full duration for the ring (default 30 min, the server's approval timeout). */
  totalMs?: number;
  /** Override the shared clock (tests, synchronized lists). */
  now?: number;
  className?: string;
};

/**
 * „läuft ab in 4:32" → below 60s „Läuft gleich ab" in danger → „Abgelaufen".
 * Announces only at 60s and 15s through its own polite live region.
 */
export function Countdown({
  expiresAt,
  variant = "text",
  label = "läuft ab in",
  totalMs = DEFAULT_TOTAL_MS,
  now: nowProp,
  className,
}: CountdownProps) {
  const clock = useNow(1000);
  const now = nowProp ?? clock;
  const known = now > 0;
  const remaining = expiresAt - now;
  const phase = known ? countdownPhase(remaining) : "normal";

  // Until the clock is known (server render, hydration) keep the width stable.
  const text = !known
    ? `${label} –:––`
    : phase === "expired"
      ? "Abgelaufen"
      : phase === "soon"
        ? "Läuft gleich ab"
        : `${label} ${formatRemaining(remaining)}`;

  const fraction = known ? Math.min(1, Math.max(0, remaining / Math.max(1, totalMs))) : 1;
  const circumference = 2 * Math.PI * 6;

  return (
    <span
      data-slot="countdown"
      data-phase={phase}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium tabular-nums",
        phase === "normal" && "text-warning",
        phase === "soon" && "text-danger",
        phase === "expired" && "text-subtle-foreground",
        className,
      )}
    >
      {variant === "ring" ? (
        <svg viewBox="0 0 16 16" aria-hidden className="size-4 shrink-0 -rotate-90">
          <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth={2} />
          <circle
            cx="8"
            cy="8"
            r="6"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - fraction)}
          />
        </svg>
      ) : null}
      <span role="timer">{text}</span>
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {known ? countdownAnnouncement(remaining) : ""}
      </span>
    </span>
  );
}
