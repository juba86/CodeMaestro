"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { FileText, Hammer, Plus, SquareTerminal } from "lucide-react";
import { sessionHref } from "@/components/layout/activity";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusIcon } from "@/components/ui/status-badge";
import type { ActivityPending, ActivityRun } from "@/hooks/use-activity";
import { useNow } from "@/hooks/use-now";
import { formatRelative } from "@/lib/format";
import { deriveRunState } from "@/lib/run-state";
import { folderLabel, newSessionHref, promptVersionLabel, type HomePrompt, type HomeSession } from "./home-logic";
import type { Resource } from "./use-resource";
import { RowsSkeleton, Widget, WidgetError } from "./widget";

// ≥40px tall on phones (thumb target), compact next to the h3 on desktop.
const HEADER_LINK =
  "-my-2 inline-flex min-h-10 items-center px-1 text-xs text-primary-text underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:-my-1 md:min-h-6";

const ROW =
  "flex min-h-12 items-center gap-3 px-3 py-2 hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring";

function EmptyRow({ icon, text, action }: { icon: ReactNode; text: string; action: ReactNode }) {
  return (
    <Card className="flex flex-col items-start gap-3 p-4">
      <p className="flex items-center gap-2 text-sm text-muted-foreground md:text-ui">
        <span aria-hidden className="text-subtle-foreground [&_svg]:size-4">
          {icon}
        </span>
        {text}
      </p>
      {action}
    </Card>
  );
}

function SessionsList({
  resource,
  runs,
  pending,
}: {
  resource: Resource<HomeSession[]>;
  runs: ActivityRun[];
  pending: ActivityPending[];
}) {
  const now = useNow(60_000);
  if (resource.error && !resource.data) {
    return <WidgetError title="Sessions konnten nicht geladen werden" message={resource.error} onRetry={resource.retry} loading={resource.loading} />;
  }
  if (!resource.data) return <RowsSkeleton rows={5} label="Sessions werden geladen …" />;
  const sessions = resource.data.slice(0, 5);
  if (sessions.length === 0) {
    return (
      <EmptyRow
        icon={<SquareTerminal />}
        text="Noch keine Session."
        action={
          <Button asChild variant="outline">
            <Link href={newSessionHref()}>
              <Plus />
              Neue Session
            </Link>
          </Button>
        }
      />
    );
  }
  return (
    <Card asChild>
      <ul className="divide-y divide-border overflow-hidden">
        {sessions.map((s) => {
          const run = runs.find((r) => r.sessionId === s.id);
          const { state } = deriveRunState({
            run: run ? { kind: run.kind, origin: run.origin, startedAt: run.startedAt } : null,
            attached: false,
            pending: pending.filter((p) => p.sessionId === s.id),
            sessionStatus: s.status,
          });
          return (
            <li key={s.id}>
              <Link href={sessionHref(s.id)} className={ROW}>
                <StatusIcon state={state} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground md:text-ui">{s.title}</p>
                  <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="truncate font-mono" title={s.cwd}>
                      {folderLabel(s.cwd)}
                    </span>
                    <span aria-hidden>·</span>
                    <span className="shrink-0">{now > 0 ? formatRelative(s.updatedAt, now) : ""}</span>
                  </p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function PromptsList({ resource }: { resource: Resource<HomePrompt[]> }) {
  const now = useNow(60_000);
  if (resource.error && !resource.data) {
    return <WidgetError title="Prompts konnten nicht geladen werden" message={resource.error} onRetry={resource.retry} loading={resource.loading} />;
  }
  if (!resource.data) return <RowsSkeleton rows={5} label="Prompts werden geladen …" />;
  const prompts = resource.data.slice(0, 5);
  if (prompts.length === 0) {
    return (
      <EmptyRow
        icon={<FileText />}
        text="Noch keine Prompts gespeichert."
        action={
          <Button asChild variant="outline">
            <Link href="/builder">
              <Hammer />
              Prompt bauen
            </Link>
          </Button>
        }
      />
    );
  }
  return (
    <Card asChild>
      <ul className="divide-y divide-border overflow-hidden">
        {prompts.map((p) => {
          const version = promptVersionLabel(p);
          return (
            <li key={p.id}>
              <Link href={`/library?prompt=${encodeURIComponent(p.id)}`} className={ROW}>
                <FileText aria-hidden className="size-4 shrink-0 text-subtle-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground md:text-ui">{p.title}</p>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {version ? (
                      <>
                        <span className="font-mono tabular-nums">{version}</span>
                        <span aria-hidden>·</span>
                      </>
                    ) : null}
                    <span>{now > 0 ? formatRelative(p.updatedAt, now) : ""}</span>
                  </p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** „Zuletzt": the 5 latest sessions and the 5 latest prompts as two lists. */
export function RecentWidget({
  sessions,
  prompts,
  runs,
  pending,
  className,
}: {
  sessions: Resource<HomeSession[]>;
  prompts: Resource<HomePrompt[]>;
  runs: ActivityRun[];
  pending: ActivityPending[];
  className?: string;
}) {
  return (
    <Widget title="Zuletzt" className={className}>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="min-w-0">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <h3 className="text-xs font-medium text-subtle-foreground">Sessions</h3>
            <Link href="/assistant" className={HEADER_LINK}>
              Alle Sessions
            </Link>
          </div>
          <SessionsList resource={sessions} runs={runs} pending={pending} />
        </div>
        <div className="min-w-0">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <h3 className="text-xs font-medium text-subtle-foreground">Prompts</h3>
            <Link href="/library" className={HEADER_LINK}>
              Bibliothek
            </Link>
          </div>
          <PromptsList resource={prompts} />
        </div>
      </div>
    </Widget>
  );
}
