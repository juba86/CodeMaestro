"use client";

import * as React from "react";
import {
  BookOpen,
  Brain,
  ChevronRight,
  CircleCheck,
  Info,
  Network,
  Repeat,
  RotateCcw,
  Sparkles,
  Square,
  Timer,
  TriangleAlert,
} from "lucide-react";
import { RoleChip, workerLabel, useOrchestraConfig } from "@/components/orchestra";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { cn } from "@/components/ui/cn";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ProviderMark } from "@/components/ui/provider-mark";
import { formatClock, formatCost } from "@/lib/format";
import { providerLabel } from "@/lib/labels";
import { loopEndText, type RunTone } from "@/lib/run-state";
import { Markdown } from "./markdown";
import type { RunEnd } from "./run-events";
import type { PlanRole } from "./thread-model";
import type { PlannedSubtask } from "./types";

/** ProviderMark line that opens a run of agent output. */
export function AgentLine({ provider, model }: { provider?: string; model?: string }) {
  if (!provider) return null;
  return (
    <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
      <ProviderMark provider={provider} label={providerLabel(provider)} sublabel={model || undefined} />
    </div>
  );
}

export function UserPrompt({ text, loop, local }: { text: string; loop: boolean; local: boolean }) {
  return (
    <div className={cn("rounded-lg bg-surface-2 p-3", local && "opacity-80")}>
      {loop ? (
        <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Repeat aria-hidden className="size-3.5" />
          Loop-Prompt · wird jede Iteration gesendet
        </div>
      ) : null}
      <p className="whitespace-pre-wrap break-words text-[15px]/6 text-foreground [overflow-wrap:anywhere] md:text-sm">{text}</p>
      {local ? <span className="sr-only">(wird gesendet)</span> : null}
    </div>
  );
}

export const AssistantMessage = React.memo(function AssistantMessage({ text }: { text: string }) {
  return <Markdown text={text} className="text-[15px]/6 text-foreground md:text-sm" />;
});

export function ThinkingRow({ text }: { text: string }) {
  const [open, setOpen] = React.useState(false);
  const id = React.useId();
  return (
    <div className="text-ui">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-md px-1 text-muted-foreground md:min-h-8 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <ChevronRight aria-hidden className={cn("size-3.5 transition-transform duration-150", open && "rotate-90")} />
        <Brain aria-hidden className="size-3.5" />
        Überlegt …
      </button>
      {open ? (
        <pre id={id} className="mt-1 max-h-72 overflow-y-auto whitespace-pre-wrap break-words border-l-2 border-border pl-3 font-sans text-ui text-muted-foreground">
          {text}
        </pre>
      ) : null}
    </div>
  );
}

export function IterationDivider({
  iteration,
  max,
  fresh,
  at,
  collapsed,
  onToggle,
}: {
  iteration: number;
  max: number;
  fresh?: boolean;
  at?: number;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const parts = [`Iteration ${iteration} von ${max}`, at ? formatClock(at) : null, fresh === undefined ? null : fresh ? "frischer Kontext" : "Kontext fortgesetzt"];
  const label = parts.filter(Boolean).join(" · ");
  return (
    <div className="flex items-center gap-3 py-1" role={onToggle ? undefined : "separator"} aria-label={onToggle ? undefined : label}>
      <span aria-hidden className="h-px flex-1 bg-border" />
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground md:min-h-8 hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Repeat aria-hidden className="size-3.5" />
          <span className="tabular-nums">{label}</span>
          <ChevronRight aria-hidden className={cn("size-3.5 transition-transform", !collapsed && "rotate-90")} />
        </button>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Repeat aria-hidden className="size-3.5" />
          <span className="tabular-nums">{label}</span>
        </span>
      )}
      <span aria-hidden className="h-px flex-1 bg-border" />
    </div>
  );
}

export function KnowledgeNote({ sources }: { sources: string[] }) {
  const n = sources.length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-info-border md:min-h-8 bg-info-subtle px-2 text-xs text-info hover:bg-info-subtle/70 focus-visible:outline-2 focus-visible:outline-ring"
        >
          <BookOpen aria-hidden className="size-3.5" />
          Wissensbasis genutzt · {n === 1 ? "1 Quelle" : `${n} Quellen`}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <p className="mb-2 text-ui font-medium">Quellen aus der Wissensbasis</p>
        <ul className="space-y-1 text-ui">
          {sources.map((s, i) => (
            <li key={i} className="break-words text-muted-foreground [overflow-wrap:anywhere]">
              {s}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-subtle-foreground">Lokal gesucht – nichts verlässt den Server.</p>
      </PopoverContent>
    </Popover>
  );
}

const TONE_TEXT: Record<RunTone, string> = {
  brand: "text-primary-text",
  warning: "text-warning",
  info: "text-info",
  success: "text-success",
  danger: "text-danger",
  neutral: "text-muted-foreground",
};

export function LoopEndNote({ reason, iterations }: { reason: string; iterations: number }) {
  const { text, tone } = loopEndText(reason, iterations);
  return (
    <div className={cn("flex items-center gap-2 py-1 text-ui", TONE_TEXT[tone])} role="note">
      {tone === "success" ? <CircleCheck aria-hidden className="size-4" /> : tone === "warning" || tone === "danger" ? <TriangleAlert aria-hidden className="size-4" /> : <Square aria-hidden className="size-4" />}
      <span className="font-medium">{text}</span>
    </div>
  );
}

export function LoopWaitNote({ resumeAt, text }: { resumeAt?: number; text: string }) {
  return (
    <div className="flex items-center gap-2 py-1 text-ui text-muted-foreground">
      <Timer aria-hidden className="size-4" />
      {resumeAt ? `Pause – nächste Iteration um ${formatClock(resumeAt)}` : text.replace(/^⏸\s*/, "")}
    </div>
  );
}

export function SystemNote({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 py-0.5 text-ui text-muted-foreground">
      <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-subtle-foreground" />
      <span className="min-w-0 break-words [overflow-wrap:anywhere]">{text}</span>
    </div>
  );
}

export function ErrorNote({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <Callout
      variant="danger"
      title="Fehler"
      action={
        onRetry ? (
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RotateCcw aria-hidden />
            Erneut ausführen
          </Button>
        ) : undefined
      }
    >
      <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words font-mono text-xs [overflow-wrap:anywhere]">{text}</pre>
    </Callout>
  );
}

/** How the last run ended (only what this device observed). */
export function RunEndNote({ ended, onRetry }: { ended: RunEnd; onRetry?: () => void }) {
  if (ended.status === "error") {
    return (
      <Callout
        variant="danger"
        announce
        title="Lauf mit Fehler beendet"
        action={
          onRetry ? (
            <Button size="sm" variant="outline" onClick={onRetry}>
              <RotateCcw aria-hidden />
              Erneut ausführen
            </Button>
          ) : undefined
        }
      >
        {ended.error ? <p className="break-words [overflow-wrap:anywhere]">{ended.error}</p> : null}
      </Callout>
    );
  }
  const cost = formatCost(ended.costUsd);
  const time = ended.at ? formatClock(ended.at) : null;
  const stopped = ended.status === "stopped";
  return (
    <div className={cn("flex items-center gap-2 py-1 text-ui", stopped ? "text-muted-foreground" : "text-success")} role="note">
      {stopped ? <Square aria-hidden className="size-4 fill-current" /> : <CircleCheck aria-hidden className="size-4" />}
      <span className="font-medium">{stopped ? "Gestoppt" : "Abgeschlossen"}</span>
      {time || cost ? <span className="text-muted-foreground tabular-nums">· {[time, cost].filter(Boolean).join(" · ")}</span> : null}
    </div>
  );
}

/** The Dirigent's plan (persisted or live). */
export function PlanBlock({
  subtasks,
  roles,
  workers,
}: {
  subtasks: PlannedSubtask[];
  roles: PlanRole[];
  workers: { id: string; label: string }[];
}) {
  const { workers: pool } = useOrchestraConfig();
  const labelOf = (id: string): string | null => {
    const known = workers.find((w) => w.id === id)?.label;
    if (known) return known;
    const w = pool?.find((x) => x.id === id);
    return w ? workerLabel(w) : null;
  };
  return (
    <div className="rounded-lg border border-primary-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-ui font-semibold">
        <Network aria-hidden className="size-4 text-primary-text" />
        Plan des Dirigenten
        <span className="font-normal text-muted-foreground">· {subtasks.length === 1 ? "1 Teilaufgabe" : `${subtasks.length} Teilaufgaben`}</span>
      </div>
      <ol className="space-y-1.5 px-3 py-2">
        {subtasks.map((s, i) => {
          const role = s.roleId ? roles.find((r) => r.id === s.roleId) : undefined;
          const model = s.workerId ? labelOf(s.workerId) : null;
          return (
            <li key={s.id ?? i} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-ui">
              <span className="w-5 shrink-0 text-right tabular-nums text-subtle-foreground">{i + 1}.</span>
              <span className="min-w-0 [overflow-wrap:anywhere]">{s.title || `Teilaufgabe ${i + 1}`}</span>
              {s.roleId ? <RoleChip roleId={s.roleId} name={role?.name} /> : null}
              {model ? <span className="text-xs text-muted-foreground">{model}</span> : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function SynthesisBlock({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-success-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-ui font-semibold">
        <Sparkles aria-hidden className="size-4 text-success" />
        Zusammenfassung
      </div>
      <div className="px-3 py-2">
        <Markdown text={text} className="text-[15px]/6 md:text-sm" />
      </div>
    </div>
  );
}

export function VerdictBadge({ verdict }: { verdict: string | null }) {
  if (verdict === "pass") return <Badge variant="success">passt</Badge>;
  if (verdict === "changes") return <Badge variant="warning">Änderungen nötig</Badge>;
  if (verdict === "unknown") return <Badge variant="neutral">ohne Urteil</Badge>;
  return null;
}
