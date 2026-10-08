"use client";

import * as React from "react";
import Link from "next/link";
import { BadgeCheck, ChevronDown, CircleAlert, Eye, Server, SlidersHorizontal, TriangleAlert, X } from "lucide-react";
import { ORCHESTRA_PRESETS, ORCHESTRA_PRESET_LABELS, type OrchestraPresetId } from "@/lib/assistant/orchestra-types";
import type { ActivityRun } from "@/hooks/use-activity";
import { badgeVariants } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { cn } from "@/components/ui/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SegmentedControl, SegmentedItem } from "@/components/ui/segmented-control";
import { Spinner } from "@/components/ui/spinner";
import { useNow } from "@/hooks/use-now";
import { formatDuration } from "@/lib/format";
import { isApplePlatform } from "@/lib/hotkeys";
import { useOrchestraPage } from "./context";
import { problemBadgeText } from "./problems";
import type { LiveConnection } from "./use-orchestra-live";

const PRESET_ICON: Record<OrchestraPresetId, React.ReactNode> = {
  quality: <BadgeCheck />,
  balanced: <SlidersHorizontal />,
  local: <Server />,
};

/** Header badge „1 Problem" / „2 Hinweise"; jumps to the first one. */
export function ProblemsBadge({ onJump, compact = false }: { onJump: () => void; compact?: boolean }) {
  const { editor } = useOrchestraPage();
  const badge = problemBadgeText(editor.counts);
  if (!badge) return null;
  const Icon = badge.tone === "danger" ? CircleAlert : TriangleAlert;
  return (
    <button
      type="button"
      onClick={onJump}
      aria-label={`${badge.text} – zum ersten springen`}
      className={cn(
        badgeVariants({ variant: badge.tone, size: "md" }),
        "cursor-pointer gap-1.5 hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        compact ? "h-10 min-w-10 justify-center px-3 text-sm [&_svg]:size-4" : "[&_svg]:size-3.5",
      )}
    >
      <Icon aria-hidden />
      <span className="tabular-nums">{compact ? badge.short : badge.text}</span>
    </button>
  );
}

function useSaveKbd(): string {
  return React.useSyncExternalStore(
    () => () => {},
    () => (isApplePlatform(navigator as Parameters<typeof isApplePlatform>[0]) ? "⌘S" : "Strg S"),
    () => "⌘S",
  );
}

export function SaveButton({ size = "sm", showKbd = true }: { size?: "sm" | "md"; showKbd?: boolean }) {
  const { editor, readOnly } = useOrchestraPage();
  const kbd = useSaveKbd();
  const reason = readOnly
    ? "Konfiguration nicht geladen"
    : !editor.ready
      ? "Wird geladen …"
      : !editor.dirty
        ? "Keine Änderungen"
        : editor.saveBlocked;
  return (
    <Button
      variant="primary"
      size={size}
      kbd={showKbd ? kbd : undefined}
      loading={editor.saving}
      disabledReason={reason ?? undefined}
      onClick={() => void editor.save()}
    >
      Speichern
    </Button>
  );
}

/** Qualität · Ausgewogen · Lokal & günstig, with the modified dot for hand-edited presets. */
export function PresetControl({ className }: { className?: string }) {
  const { editor, readOnly } = useOrchestraPage();
  const draft = editor.draft;
  const modifiedFrom = draft?.preset === "custom" ? editor.basedOn : null;
  const value = draft ? (draft.preset !== "custom" ? draft.preset : editor.basedOn ?? "") : "";
  const busy = editor.applyingPreset;
  return (
    <SegmentedControl
      aria-label="Besetzung"
      value={value}
      onValueChange={(v) => void editor.applyPreset(v as OrchestraPresetId)}
      disabled={!editor.ready || readOnly || !!busy}
      className={className}
    >
      {ORCHESTRA_PRESETS.map((p) => (
        <SegmentedItem
          key={p}
          value={p}
          icon={busy === p ? <Spinner /> : PRESET_ICON[p]}
          modified={modifiedFrom === p}
          // Clicking the modified preset again reloads it (the control never empties itself).
          onClick={() => {
            if (modifiedFrom === p) void editor.applyPreset(p);
          }}
        >
          {ORCHESTRA_PRESET_LABELS[p]}
        </SegmentedItem>
      ))}
    </SegmentedControl>
  );
}

/** „‚Ausgewogen‘ · geändert: Tester, Doku" / „Eigene Besetzung" / „noch nicht gespeichert". */
export function PresetNote({ className }: { className?: string }) {
  const { editor } = useOrchestraPage();
  const draft = editor.draft;
  if (!draft) return null;
  let text: string | null = null;
  if (draft.preset === "custom" && editor.basedOn) {
    const names = editor.changedNames;
    text = `„${ORCHESTRA_PRESET_LABELS[editor.basedOn]}“ · geändert${names.length ? `: ${names.join(", ")}` : ""}`;
  } else if (draft.preset === "custom") {
    text = ORCHESTRA_PRESET_LABELS.custom;
  } else if (editor.dirty) {
    text = `„${ORCHESTRA_PRESET_LABELS[draft.preset]}“ · noch nicht gespeichert`;
  }
  if (!text) return null;
  return (
    <p className={cn("min-w-0 truncate text-xs text-muted-foreground", className)} title={text}>
      {text}
    </p>
  );
}

export function PresetWarnings({ className }: { className?: string }) {
  const { editor } = useOrchestraPage();
  const warnings = editor.presetWarnings;
  if (!warnings?.length) return null;
  return (
    <Callout
      variant="warning"
      announce
      title="Hinweise zur Besetzung"
      onDismiss={editor.dismissPresetWarnings}
      dismissLabel="Hinweise schließen"
      className={className}
    >
      <ul className="list-disc space-y-0.5 pl-4">
        {warnings.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </Callout>
  );
}

export interface LiveBannerProps {
  runs: ActivityRun[];
  follow: { sessionId: string; title: string } | null;
  onFollow: (run: { sessionId: string; title: string } | null) => void;
  connection: LiveConnection;
  compact?: boolean;
  className?: string;
}

const viewHref = (sid: string) => `/assistant?session=${encodeURIComponent(sid)}`;

/** „Live · ‚Auth-Refactor‘ · Coder arbeitet an Teilaufgabe 3/5 · Ansehen" (from useActivity; details while followed). */
export function LiveBanner({ runs, follow, onFollow, connection, compact = false, className }: LiveBannerProps) {
  const { live } = useOrchestraPage();
  // The elapsed time only ticks while a run is shown.
  const now = useNow(follow || runs.length ? 1000 : 60_000);
  const single = !follow && runs.length === 1 ? runs[0] : null;
  if (!follow && !runs.length) return null;

  const others = runs.filter((r) => r.sessionId !== follow?.sessionId);
  const title = follow?.title ?? single?.title ?? "";
  const active = follow ? !!live?.active || connection === "connecting" : true;
  let text: string;
  if (follow) {
    text = live && (live.active || connection !== "connecting") ? live.summary : "verbinde …";
    if (connection === "reconnecting") text += " · Verbindung wird wiederhergestellt …";
  } else if (single) {
    text = now ? `läuft seit ${formatDuration(now - single.startedAt)}` : "läuft";
  } else {
    text = "";
  }
  const sessionId = follow?.sessionId ?? single?.sessionId ?? null;
  // Screen readers hear state changes of the followed run only — never the ticking timer.
  // Nothing until the first events (or the end) are known, so it never says „Beendet" while connecting.
  const spoken = follow && live && (live.active || connection === "ended") ? `${live.active ? "Live" : "Beendet"}: ${live.summary}` : "";

  const picker =
    others.length && (follow || runs.length > 1) ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size={compact ? "md" : "xs"} className="shrink-0 px-2 text-primary-text">
            {follow ? `+${others.length}` : `${runs.length} Läufe live`}
            <ChevronDown />
            {follow ? <span className="sr-only"> weitere Läufe</span> : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel>Lauf im Organigramm zeigen</DropdownMenuLabel>
          {(follow ? others : runs).map((r) => (
            <DropdownMenuItem key={r.sessionId} onSelect={() => onFollow({ sessionId: r.sessionId, title: r.title })}>
              <span className="min-w-0 flex-1 truncate">„{r.title || "Ohne Titel"}“</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{now ? formatDuration(now - r.startedAt) : ""}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null;

  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-md border text-xs",
        // Phones: 40px targets inside the banner (§7).
        compact ? "min-h-11 py-0.5 pl-2.5 pr-0.5" : "min-h-8 px-2.5 py-1",
        active ? "border-primary-border bg-primary-subtle" : "border-border-strong bg-surface-2",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn("size-2 shrink-0 rounded-full", active ? "bg-primary motion-safe:animate-breathe" : "bg-subtle-foreground")}
      />
      <span className="min-w-0 flex-1 truncate">
        {follow || single ? (
          <>
            <b className="font-semibold">{active ? "Live" : "Beendet"}</b>
            {title ? <> · „{title}“</> : null}
            {text ? <> · {text}</> : null}
          </>
        ) : (
          <b className="font-semibold">{runs.length} Läufe live</b>
        )}
      </span>
      {picker}
      {!follow && single ? (
        compact ? (
          <IconButton
            aria-label="Live im Organigramm zeigen"
            size="icon"
            variant="ghost"
            className="shrink-0 text-primary-text"
            onClick={() => onFollow({ sessionId: single.sessionId, title: single.title })}
          >
            <Eye />
          </IconButton>
        ) : (
          <Button
            variant="ghost"
            size="xs"
            className="shrink-0 text-primary-text"
            onClick={() => onFollow({ sessionId: single.sessionId, title: single.title })}
          >
            <Eye />
            Live zeigen
          </Button>
        )
      ) : null}
      {sessionId ? (
        <Link
          href={viewHref(sessionId)}
          className={cn(
            "inline-flex shrink-0 items-center rounded-sm font-medium text-primary-text underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            compact ? "min-h-10 px-2" : "min-h-6 px-1",
          )}
        >
          Ansehen
        </Link>
      ) : null}
      {follow ? (
        <IconButton
          aria-label="Live-Ansicht schließen"
          size={compact ? "icon" : "icon-sm"}
          variant="ghost"
          className={cn("shrink-0", !compact && "-mr-1")}
          onClick={() => onFollow(null)}
        >
          <X />
        </IconButton>
      ) : null}
      <span className="sr-only" aria-live="polite">
        {spoken}
      </span>
    </div>
  );
}
