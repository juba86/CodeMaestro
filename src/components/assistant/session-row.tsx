"use client";

import * as React from "react";
import Link from "next/link";
import { MoreHorizontal, Square, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { StatusIcon } from "@/components/ui/status-badge";
import type { ActivityPending, ActivityRun } from "@/hooks/use-activity";
import { formatRelative } from "@/lib/format";
import { providerLabel } from "@/lib/labels";
import { RUN_STATE_META, isActive, type RunState } from "@/lib/run-state";
import { folderName } from "./session-list";
import type { SessionSummary } from "./types";

export function pendingLabel(pending: { type: string; kind?: string }[]): string | null {
  if (!pending.length) return null;
  const approvals = pending.filter((p) => p.type === "approval_request").length;
  if (approvals) return approvals === 1 ? "1 Freigabe offen" : `${approvals} Freigaben offen`;
  if (pending.some((p) => p.kind === "plan")) return "Plan offen";
  return pending.length === 1 ? "Frage offen" : `${pending.length} Fragen offen`;
}

export interface SessionRowProps {
  session: SessionSummary;
  state: RunState;
  run?: ActivityRun;
  pending: ActivityPending[];
  /** „Loop 4/10" for the open session (known from its stream). */
  loopLabel?: string | null;
  selected: boolean;
  now: number;
  /** Desktop: switch in place (no navigation). */
  onOpen?: (id: string) => void;
  onStop: (s: SessionSummary) => void;
  onDelete: (s: SessionSummary) => void;
  href: string;
  /** Mobile rows push a history entry (back returns to the list). */
  replace: boolean;
}

export const SessionRow = React.memo(function SessionRow({
  session: s,
  state,
  run,
  pending,
  loopLabel,
  selected,
  now,
  onOpen,
  onStop,
  onDelete,
  href,
  replace,
}: SessionRowProps) {
  const active = isActive(state);
  const folder = folderName(s.cwd);
  let extra: React.ReactNode = providerLabel(s.provider);
  if (state === "error") extra = <span className="text-danger">Letzter Lauf mit Fehler</span>;
  else if (run?.origin === "telegram") extra = <span className="text-info">via Telegram</span>;
  else if (run?.kind === "loop") extra = loopLabel ?? "Loop läuft";
  else if (run?.kind === "orchestrate") extra = "Orchester";
  const badge = pendingLabel(pending);
  const time = formatRelative(s.updatedAt, now);

  return (
    <li className="group/row relative">
      <Link
        href={href}
        replace={replace}
        aria-current={selected ? "page" : undefined}
        onClick={(e) => {
          if (!onOpen || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          onOpen(s.id);
        }}
        data-session-id={s.id}
        className={cn(
          "flex min-h-14 w-full min-w-0 gap-2.5 rounded-lg border border-transparent py-2 pl-2.5 pr-2.5 text-left transition-colors duration-150 [@media(hover:none)]:pr-12",
          "hover:bg-accent/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
          selected && "border-border bg-accent",
        )}
      >
        <StatusIcon state={state} className="mt-0.5" aria-label={RUN_STATE_META[state].label} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground md:text-ui">{s.title || folder}</span>
            <span className="shrink-0 text-xs tabular-nums text-subtle-foreground">{time}</span>
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {folder} · {extra}
          </span>
          {badge ? (
            <span>
              <Badge variant={pending.some((p) => p.type === "approval_request") ? "warning" : "info"}>{badge}</Badge>
            </span>
          ) : null}
        </span>
      </Link>
      <div
        className={cn(
          // Over the time on desktop (hover/focus); always visible on touch.
          "absolute right-1 top-1.5 rounded-md bg-surface opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100 has-[[data-state=open]]:opacity-100 [@media(hover:none)]:bg-transparent [@media(hover:none)]:opacity-100",
          selected && "bg-accent",
        )}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton aria-label={`Aktionen für ${s.title || folder}`} size="icon" className="md:size-7">
              <MoreHorizontal />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {active ? (
              <DropdownMenuItem onSelect={() => onStop(s)}>
                <Square />
                Lauf stoppen
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem variant="danger" onSelect={() => onDelete(s)}>
              <Trash2 />
              Session löschen
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
});
