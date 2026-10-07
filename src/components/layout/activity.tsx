"use client";

import * as React from "react";
import Link from "next/link";
import {
  Activity,
  ChevronRight,
  CloudUpload,
  FilePen,
  FilePlus,
  FileText,
  ListChecks,
  MessageCircleQuestion,
  ShieldAlert,
  Terminal,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { useActivity, type ActivityPending, type ActivityRun } from "@/hooks/use-activity";
import { useNow } from "@/hooks/use-now";
import { CONNECTION_OVERLAY_META, deriveRunState } from "@/lib/run-state";
import { formatDuration } from "@/lib/format";
import { runOriginLabel } from "@/lib/labels";
import { cn } from "@/components/ui/cn";
import { Button } from "@/components/ui/button";
import { Countdown } from "@/components/ui/countdown";
import { StatusBadge } from "@/components/ui/status-badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SimpleTooltip } from "@/components/ui/tooltip";
import {
  activityAriaLabel,
  describePending,
  pendingTitle,
  runningText,
  waitingText,
  type PendingKind,
} from "./activity-format";
import { useShellOverlays } from "./shell-state";

const PENDING_ICON: Record<PendingKind, LucideIcon> = {
  edit: FilePen,
  create: FilePlus,
  write: FileText,
  command: Terminal,
  push: CloudUpload,
  question: MessageCircleQuestion,
  plan: ListChecks,
  tool: ShieldAlert,
};

export const sessionHref = (sessionId: string) => `/assistant?session=${encodeURIComponent(sessionId)}`;

// ---------------------------------------------------------------------------
// Panel (shared by the desktop popover and the mobile sheet)
// ---------------------------------------------------------------------------

function PendingRow({ item, onNavigate }: { item: ActivityPending; onNavigate?: () => void }) {
  const summary = describePending(item);
  const Icon = PENDING_ICON[summary.kind];
  return (
    <li className="flex items-center gap-3 rounded-lg px-2 py-2">
      <span
        aria-hidden
        className="grid size-8 shrink-0 place-items-center rounded-md bg-warning-subtle text-warning [&_svg]:size-4"
      >
        <Icon />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium md:text-ui" title={summary.detail ?? undefined}>
          {summary.label}
          {summary.target ? (
            <>
              : <span className="font-mono text-[0.95em]">{summary.target}</span>
            </>
          ) : null}
        </p>
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate">{item.sessionTitle}</span>
          {item.expiresAt ? (
            <>
              <span aria-hidden>·</span>
              <Countdown expiresAt={item.expiresAt} className="shrink-0" />
            </>
          ) : null}
        </p>
      </div>
      <Button asChild variant="outline" size="md" className="shrink-0">
        <Link
          href={sessionHref(item.sessionId)}
          onClick={onNavigate}
          aria-label={`Öffnen: ${pendingTitle(summary)} in ${item.sessionTitle}`}
        >
          Öffnen
        </Link>
      </Button>
    </li>
  );
}

function RunRow({
  run,
  pending,
  now,
  onNavigate,
}: {
  run: ActivityRun;
  pending: ActivityPending[];
  now: number;
  onNavigate?: () => void;
}) {
  const { state } = deriveRunState({
    run: { kind: run.kind, origin: run.origin, startedAt: run.startedAt },
    attached: false,
    pending: pending.filter((p) => p.sessionId === run.sessionId),
  });
  const elapsed = now > 0 ? formatDuration(now - run.startedAt) : "–:––";
  const kind = run.kind === "orchestrate" ? "Orchester" : run.kind === "loop" ? "Loop" : null;
  return (
    <li>
      <Link
        href={sessionHref(run.sessionId)}
        onClick={onNavigate}
        className="flex min-h-12 items-center gap-3 rounded-lg px-2 py-2 hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:min-h-11"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium md:text-ui">{run.title}</p>
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="tabular-nums">{elapsed}</span>
            <span aria-hidden>·</span>
            <span className="truncate">
              {runOriginLabel(run.origin)}
              {kind ? ` · ${kind}` : ""}
            </span>
          </p>
        </div>
        <StatusBadge state={state} className="shrink-0" />
      </Link>
    </li>
  );
}

function SectionTitle({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h3 id={id} className="px-2 pb-1 pt-2 text-xs font-medium text-subtle-foreground">
      {children}
    </h3>
  );
}

/** Wartet auf dich + Läuft lists (§5.4). No approve/deny here: deciding needs the diff. */
export function ActivityPanel({ onNavigate, className }: { onNavigate?: () => void; className?: string }) {
  const { runs, pending, loading } = useActivity();
  const now = useNow(1000);
  const id = React.useId();

  if (runs.length === 0 && pending.length === 0) {
    return (
      <p className={cn("px-2 py-6 text-center text-ui text-muted-foreground", className)}>
        {loading ? "Wird geladen …" : "Gerade läuft nichts."}
      </p>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {pending.length > 0 ? (
        <section aria-labelledby={`${id}-wait`}>
          <SectionTitle id={`${id}-wait`}>Wartet auf dich</SectionTitle>
          <ul className="flex flex-col">
            {pending.map((p) => (
              <PendingRow key={p.approvalId} item={p} onNavigate={onNavigate} />
            ))}
          </ul>
        </section>
      ) : null}
      {runs.length > 0 ? (
        <section aria-labelledby={`${id}-run`}>
          <SectionTitle id={`${id}-run`}>Läuft</SectionTitle>
          <ul className="flex flex-col">
            {runs.map((r) => (
              <RunRow key={r.sessionId} run={r} pending={pending} now={now} onNavigate={onNavigate} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

function RunningDot({ className }: { className?: string }) {
  return <span aria-hidden className={cn("size-2 shrink-0 rounded-full bg-primary motion-safe:animate-breathe", className)} />;
}

/** Sidebar chip „● 1 läuft · ⚠ 1 Freigabe ›" with the Activity popover (hidden while idle). */
export function ActivityChip() {
  const { counts } = useActivity();
  const [open, setOpen] = React.useState(false);
  const active = counts.running + counts.waiting > 0;
  if (!active && !open) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={activityAriaLabel(counts.running, counts.waiting)}
          className="flex h-8 w-full items-center gap-3 rounded-md border border-border bg-background px-2 text-xs font-medium hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {counts.running > 0 ? (
            <span className="inline-flex items-center gap-1.5">
              <RunningDot />
              {runningText(counts.running)}
            </span>
          ) : null}
          {counts.waiting > 0 ? (
            <span className="inline-flex items-center gap-1.5 text-warning">
              <ShieldAlert aria-hidden className="size-3.5" />
              {waitingText(counts.waiting)}
            </span>
          ) : null}
          <ChevronRight aria-hidden className="ml-auto size-3.5 text-subtle-foreground" />
        </button>
      </PopoverTrigger>
      <ActivityPopoverContent onNavigate={() => setOpen(false)} side="bottom" />
    </Popover>
  );
}

function ActivityPopoverContent({ onNavigate, side }: { onNavigate: () => void; side: "bottom" | "right" }) {
  return (
    <PopoverContent
      side={side}
      align="start"
      aria-label="Aktivität"
      className="w-[380px] max-h-[min(70vh,560px)] overflow-y-auto p-2"
    >
      <ActivityPanel onNavigate={onNavigate} />
    </PopoverContent>
  );
}

/** Rail form: icon button with a count dot (hidden while idle). */
export function ActivityRailButton() {
  const { counts } = useActivity();
  const [open, setOpen] = React.useState(false);
  const active = counts.running + counts.waiting > 0;
  if (!active && !open) return null;
  const waiting = counts.waiting > 0;
  const label = activityAriaLabel(counts.running, counts.waiting);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <SimpleTooltip content={label} side="right">
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className="relative grid size-10 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Activity aria-hidden className="size-4" />
            <span
              aria-hidden
              className={cn(
                "absolute right-0.5 top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 text-xs font-semibold leading-none tabular-nums ring-2 ring-surface",
                waiting ? "bg-warning text-background" : "bg-primary text-primary-foreground",
              )}
            >
              {waiting ? counts.waiting : counts.running}
            </span>
          </button>
        </PopoverTrigger>
      </SimpleTooltip>
      <ActivityPopoverContent onNavigate={() => setOpen(false)} side="right" />
    </Popover>
  );
}

/** Mobile AppBar chip „●1 ⚠1" (only while active); opens the Activity sheet. */
export function ActivityAppBarChip() {
  const { counts } = useActivity();
  const setActivity = useShellOverlays((s) => s.setActivity);
  if (counts.running + counts.waiting === 0) return null;
  return (
    <button
      type="button"
      onClick={() => setActivity(true)}
      aria-label={activityAriaLabel(counts.running, counts.waiting)}
      aria-haspopup="dialog"
      className="inline-flex h-10 items-center gap-2.5 rounded-full border border-border bg-background px-3 text-xs font-semibold tabular-nums hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {counts.running > 0 ? (
        <span className="inline-flex items-center gap-1.5">
          <RunningDot />
          {counts.running}
        </span>
      ) : null}
      {counts.waiting > 0 ? (
        <span className="inline-flex items-center gap-1 text-warning">
          <ShieldAlert aria-hidden className="size-4" />
          {counts.waiting}
        </span>
      ) : null}
    </button>
  );
}

const OFFLINE_TEXT = CONNECTION_OVERLAY_META.offline.label;

/**
 * Mobile AppBar marker while the server is unreachable (§4.4: two failed
 * polls); the desktop shows the same in the sidebar server line.
 */
export function OfflineAppBarChip() {
  const { reachable } = useActivity();
  if (reachable) return null;
  return (
    <span
      title={OFFLINE_TEXT}
      className="inline-flex h-7 items-center gap-1 rounded-full border border-warning-border bg-warning-subtle px-2 text-xs font-medium text-warning"
    >
      <WifiOff aria-hidden className="size-3.5" />
      Offline
    </span>
  );
}

/** Announces reachability changes once (polite): offline / „Wieder verbunden". */
export function ConnectionAnnouncer() {
  const { reachable } = useActivity();
  const [prev, setPrev] = React.useState(reachable);
  const [message, setMessage] = React.useState("");
  if (prev !== reachable) {
    setPrev(reachable);
    setMessage(reachable ? "Wieder verbunden" : `Server nicht erreichbar. ${OFFLINE_TEXT}`);
  }
  return (
    <p role="status" aria-atomic="true" className="sr-only">
      {message}
    </p>
  );
}

/** Mobile Activity bottom sheet (opened from the AppBar chip and the GateBanner). */
export function ActivitySheet() {
  const open = useShellOverlays((s) => s.activity);
  const setActivity = useShellOverlays((s) => s.setActivity);
  return (
    <Sheet open={open} onOpenChange={setActivity}>
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>Aktivität</SheetTitle>
          <SheetDescription className="sr-only">Laufende Sessions und offene Freigaben</SheetDescription>
        </SheetHeader>
        <SheetBody className="px-2">
          <ActivityPanel onNavigate={() => setActivity(false)} />
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
