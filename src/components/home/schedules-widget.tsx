"use client";

import Link from "next/link";
import { CalendarClock, Link2 } from "lucide-react";
import { sessionHref } from "@/components/layout/activity";
import { nextRunLabel, rhythmLabel, sortSchedules } from "@/components/assistant/schedule-logic";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { useNow } from "@/hooks/use-now";
import type { ScheduleView } from "@/lib/schedule/types";
import { folderLabel } from "./home-logic";
import type { Resource } from "./use-resource";
import { RowsSkeleton, Widget, WidgetError } from "./widget";

const MAX_ROWS = 5;

/** „Zeitpläne": the enabled schedules, soonest first — the sessions that work on their own. */
export function SchedulesWidget({ schedules, className }: { schedules: Resource<ScheduleView[]>; className?: string }) {
  const now = useNow(30_000);
  if (schedules.error && !schedules.data) {
    return (
      <Widget title="Zeitpläne" className={className}>
        <WidgetError title="Zeitpläne konnten nicht geladen werden" message={schedules.error} onRetry={schedules.retry} loading={schedules.loading} />
      </Widget>
    );
  }
  if (!schedules.data) {
    return (
      <Widget title="Zeitpläne" className={className}>
        <RowsSkeleton rows={2} label="Zeitpläne werden geladen …" />
      </Widget>
    );
  }
  const active = sortSchedules(schedules.data.filter((s) => s.enabled));
  if (active.length === 0) return null;
  const rows = active.slice(0, MAX_ROWS);
  return (
    <Widget
      title="Zeitpläne"
      meta={<Badge variant="brand">{active.length}</Badge>}
      className={className}
    >
      <ul className="flex flex-col gap-1 rounded-lg border border-border bg-card p-2 shadow-xs" aria-label="Aktive Zeitpläne">
        {rows.map((s) => {
          const running = s.lastStatus === "running";
          return (
            <li key={s.id}>
              <Link
                href={sessionHref(s.sessionId)}
                className="flex min-h-11 items-center gap-3 rounded-md px-2 py-1.5 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                aria-label={`${s.name} in ${s.session?.title ?? ""} öffnen`}
              >
                <span aria-hidden className={cn("grid size-8 shrink-0 place-items-center rounded-md bg-primary-subtle text-primary-text [&_svg]:size-4", running && "motion-safe:animate-pulse")}>
                  {s.cron ? <CalendarClock /> : <Link2 />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground md:text-ui">{s.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {s.session ? `${s.session.title || folderLabel(s.session.cwd)} · ` : ""}
                    {rhythmLabel(s)}
                  </span>
                </span>
                <span className={cn("shrink-0 text-xs", running ? "text-primary-text" : "text-subtle-foreground")}>{now > 0 ? nextRunLabel(s, now) : ""}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Widget>
  );
}
