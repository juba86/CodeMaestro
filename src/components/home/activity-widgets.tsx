"use client";

import Link from "next/link";
import {
  FilePen, FilePlus, FileText, GitBranch, ListChecks, MessageCircleQuestion, ShieldAlert, SquareTerminal, type LucideIcon,
} from "lucide-react";
import { sessionHref } from "@/components/layout/activity";
import { describePending, pendingTitle, type PendingKind } from "@/components/layout/activity-format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Countdown } from "@/components/ui/countdown";
import { StatusBadge } from "@/components/ui/status-badge";
import type { ActivityPending, ActivityRun } from "@/hooks/use-activity";
import { useNow } from "@/hooks/use-now";
import { formatDuration } from "@/lib/format";
import { runKindLabel, runOriginLabel } from "@/lib/labels";
import { deriveRunState } from "@/lib/run-state";
import { folderLabel } from "./home-logic";
import { Widget } from "./widget";

const PENDING_ICON: Record<PendingKind, LucideIcon> = {
  edit: FilePen,
  create: FilePlus,
  write: FileText,
  command: SquareTerminal,
  push: GitBranch,
  question: MessageCircleQuestion,
  plan: ListChecks,
  tool: ShieldAlert,
};

/** „Wartet auf dich": open approvals and questions. No blind approve — deciding needs the diff. */
export function WaitingWidget({ pending, className }: { pending: ActivityPending[]; className?: string }) {
  if (pending.length === 0) return null;
  return (
    <Widget title="Wartet auf dich" meta={<Badge variant="warning">{pending.length}</Badge>} className={className}>
      <ul className="flex flex-col gap-2">
        {pending.map((p) => {
          const summary = describePending(p);
          const Icon = PENDING_ICON[summary.kind];
          return (
            <li key={p.approvalId}>
              <Card variant="warning" className="flex items-center gap-3 p-3">
                <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-md bg-warning-subtle text-warning [&_svg]:size-4">
                  <Icon />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground md:text-ui" title={summary.detail ?? undefined}>
                    {summary.label}
                    {summary.target ? (
                      <>
                        : <span className="font-mono text-[0.95em]">{summary.target}</span>
                      </>
                    ) : null}
                  </p>
                  <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="truncate">{p.sessionTitle}</span>
                    {p.expiresAt ? (
                      <>
                        <span aria-hidden>·</span>
                        <Countdown expiresAt={p.expiresAt} className="shrink-0" />
                      </>
                    ) : null}
                  </p>
                </div>
                <Button asChild variant="primary" className="shrink-0">
                  <Link href={sessionHref(p.sessionId)} aria-label={`Öffnen: ${pendingTitle(summary)} in ${p.sessionTitle}`}>
                    Öffnen
                  </Link>
                </Button>
              </Card>
            </li>
          );
        })}
      </ul>
    </Widget>
  );
}

/** „Läuft": active runs with state, elapsed time and origin. */
export function RunningWidget({ runs, pending, className }: { runs: ActivityRun[]; pending: ActivityPending[]; className?: string }) {
  const now = useNow(1000);
  if (runs.length === 0) return null;
  return (
    <Widget title="Läuft" meta={<Badge variant="brand">{runs.length}</Badge>} className={className}>
      <ul className="flex flex-col gap-2">
        {runs.map((run) => {
          const { state } = deriveRunState({
            run: { kind: run.kind, origin: run.origin, startedAt: run.startedAt },
            attached: false,
            pending: pending.filter((p) => p.sessionId === run.sessionId),
          });
          const elapsed = now > 0 ? formatDuration(now - run.startedAt) : "–:––";
          return (
            <li key={run.sessionId}>
              <Card asChild variant="interactive">
                <Link href={sessionHref(run.sessionId)} className="flex min-h-14 items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground md:text-ui">{run.title}</p>
                    <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="tabular-nums">{elapsed}</span>
                      <span aria-hidden>·</span>
                      <span className="truncate">
                        {runOriginLabel(run.origin)}
                        {run.kind !== "turn" ? ` · ${runKindLabel(run.kind)}` : ""}
                      </span>
                      {run.cwd ? (
                        <>
                          <span aria-hidden className="hidden sm:inline">·</span>
                          <span className="hidden truncate font-mono sm:inline">{folderLabel(run.cwd)}</span>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <StatusBadge state={state} className="shrink-0" />
                </Link>
              </Card>
            </li>
          );
        })}
      </ul>
    </Widget>
  );
}
