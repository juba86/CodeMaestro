"use client";

import * as React from "react";
import { ChevronRight, MessageSquareDashed, Wrench } from "lucide-react";
import { RoleChip, type OrchestraLiveSubtask } from "@/components/orchestra";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { formatDuration } from "@/lib/format";
import { Markdown } from "./markdown";
import { VerdictBadge } from "./thread-blocks";
import type { SubtaskPart, SubtaskSectionModel } from "./thread-model";

function statusBadge(live: OrchestraLiveSubtask | undefined, section: SubtaskSectionModel, now: number) {
  if (live) {
    switch (live.status) {
      case "working": {
        const t = live.startedAt && now > live.startedAt ? ` · ${formatDuration(now - live.startedAt)}` : "";
        return (
          <Badge variant="brand" className="tabular-nums">
            <span aria-hidden className="size-1.5 rounded-full bg-current motion-safe:animate-breathe" />
            arbeitet{t}
          </Badge>
        );
      }
      case "review":
        return <Badge variant="brand">wird geprüft</Badge>;
      case "fixing":
        return <Badge variant="brand">Korrektur nach Runde {live.fixRound ?? 1}</Badge>;
      case "waiting":
        return <Badge variant="neutral">wartet</Badge>;
      case "error":
        return <Badge variant="danger">Fehler</Badge>;
      case "stopped":
        return <Badge variant="neutral">gestoppt</Badge>;
      case "done":
        return <Badge variant="success">fertig</Badge>;
    }
  }
  if (section.hasError) return <Badge variant="danger">Fehler</Badge>;
  return <Badge variant="success">fertig</Badge>;
}

function Nested({
  title,
  badge,
  icon,
  defaultOpen,
  children,
}: {
  title: React.ReactNode;
  badge?: React.ReactNode;
  icon: React.ReactNode;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const id = React.useId();
  return (
    <div className="rounded-md border border-border bg-background">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-10 w-full min-w-0 items-center gap-2 px-2.5 text-left text-ui hover:bg-accent/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring md:min-h-8"
      >
        <ChevronRight aria-hidden className={cn("size-3.5 shrink-0 text-subtle-foreground transition-transform", open && "rotate-90")} />
        {icon}
        <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
        {badge}
      </button>
      {open ? (
        <div id={id} className="border-t border-border px-3 py-2">
          {children}
        </div>
      ) : null}
    </div>
  );
}

function PartView({ part, last, live }: { part: SubtaskPart; last: boolean; live: boolean }) {
  switch (part.kind) {
    case "work":
      return part.text.trim() ? (
        <Markdown text={part.text} className="text-[15px]/6 md:text-sm" />
      ) : live ? (
        <p className="text-ui text-muted-foreground">Noch keine Ausgabe …</p>
      ) : (
        <p className="text-ui text-muted-foreground">Kein Output.</p>
      );
    case "review": {
      const rounds = part.maxRounds ? `Runde ${part.round}/${Math.max(part.maxRounds, part.round)}` : `Runde ${part.round}`;
      const who = part.reviewerName || "Reviewer";
      const title = part.verdict ? `${who} hat geprüft · ${rounds}` : `${who} prüft · ${rounds}`;
      return (
        <Nested
          title={title}
          icon={<MessageSquareDashed aria-hidden className="size-4 shrink-0 text-subtle-foreground" />}
          badge={<VerdictBadge verdict={part.verdict} />}
          defaultOpen={(live && last) || part.verdict === "changes"}
        >
          {part.reviewerLabel ? <p className="mb-1 text-xs text-subtle-foreground">{part.reviewerLabel}</p> : null}
          {part.text.trim() ? <Markdown text={part.text} className="text-ui" /> : <p className="text-ui text-muted-foreground">Prüft …</p>}
        </Nested>
      );
    }
    case "fix":
      return (
        <Nested title={`Korrektur nach Runde ${part.round}`} icon={<Wrench aria-hidden className="size-4 shrink-0 text-subtle-foreground" />} defaultOpen={live && last}>
          <Markdown text={part.text} className="text-ui" />
        </Nested>
      );
    case "error":
      return (
        <p className="whitespace-pre-wrap rounded-md border border-danger-border bg-danger-subtle px-2.5 py-1.5 text-ui text-danger [overflow-wrap:anywhere]">
          {part.review ? "Prüfung: " : part.round ? `Korrektur ${part.round}: ` : ""}
          {part.text}
        </p>
      );
  }
}

/** One orchestrator subtask with its review rounds and fix rounds (DESIGN.md §6.2.4). */
export function SubtaskSection({
  section,
  liveSubtask,
  now,
}: {
  section: SubtaskSectionModel;
  liveSubtask?: OrchestraLiveSubtask;
  now: number;
}) {
  const [open, setOpen] = React.useState(true);
  const id = React.useId();
  const working = !!liveSubtask && ["working", "review", "fixing"].includes(liveSubtask.status);
  const worker = liveSubtask?.workerLabel ?? section.workerLabel;
  return (
    <section
      data-subtask-id={section.subtaskId}
      aria-labelledby={`${id}-title`}
      className={cn(
        "relative scroll-mt-4 overflow-hidden rounded-lg border bg-card",
        working ? "border-primary-border" : "border-border",
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-body`}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex min-h-11 w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-left hover:bg-accent/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
          working && "bg-primary-subtle",
        )}
      >
        <ChevronRight aria-hidden className={cn("size-4 shrink-0 text-subtle-foreground transition-transform", open && "rotate-90")} />
        {section.roleId || section.roleName ? <RoleChip roleId={section.roleId} name={section.roleName} /> : null}
        {worker ? <span className="text-xs text-muted-foreground">{worker}</span> : null}
        <span id={`${id}-title`} className="min-w-0 flex-[1_1_12rem] text-ui font-medium [overflow-wrap:anywhere]">
          {section.index ? <span className="mr-1 tabular-nums text-subtle-foreground">{section.index}.</span> : null}
          {section.title}
        </span>
        {statusBadge(liveSubtask, section, now)}
      </button>
      {open ? (
        <div id={`${id}-body`} className="space-y-2 border-t border-border px-3 py-2.5">
          {section.parts.length === 0 ? <p className="text-ui text-muted-foreground">Noch keine Ausgabe …</p> : null}
          {section.parts.map((p, i) => (
            <PartView key={p.key + i} part={p} last={i === section.parts.length - 1} live={section.live} />
          ))}
        </div>
      ) : null}
      {working ? (
        <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-primary/15">
          <span className="block h-full w-2/5 bg-primary motion-safe:animate-sweep" />
        </span>
      ) : null}
    </section>
  );
}
