"use client";

import * as React from "react";
import { Check, ListChecks, Network, Play } from "lucide-react";
import { RoleChip, workerLabel } from "@/components/orchestra";
import type { OrchestraWorkerInfo } from "@/lib/assistant/orchestra-types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Countdown } from "@/components/ui/countdown";
import { SimpleSelect } from "@/components/ui/select";
import { HintEditor } from "./approval-card";
import { gateDomId, useGates } from "./gate-context";
import { Markdown } from "./markdown";
import { PLAN_REJECT_REASON, planReviseReason } from "./question-logic";
import type { PendingCard } from "./run-events";
import type { PlannedSubtask } from "./types";
import { useIsMobile } from "@/hooks/use-media-query";

/** ExitPlanMode: the agent's plan waits for approval (DESIGN.md §6.2.7). */
export function PlanApprovalCard({ card }: { card: PendingCard }) {
  const { decide, openHint } = useGates();
  const isMobile = useIsMobile();
  const titleId = React.useId();
  const [revise, setRevise] = React.useState(false);
  const [hint, setHint] = React.useState("");
  return (
    <Card
      id={gateDomId(card.approvalId)}
      variant="warning"
      role="region"
      aria-labelledby={titleId}
      className="scroll-mt-4 overflow-hidden"
      data-gate={card.approvalId}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-warning-border bg-warning-subtle px-3 py-2">
        <ListChecks aria-hidden className="size-4 shrink-0 text-warning" />
        <h2 id={titleId} tabIndex={-1} data-gate-heading className="text-ui font-semibold text-foreground outline-none">
          Plan freigeben?
        </h2>
        {card.expiresAt ? <Countdown expiresAt={card.expiresAt} variant="ring" className="ml-auto" /> : null}
      </div>
      <div className="space-y-3 p-3">
        {card.plan ? (
          <div className="max-h-[50vh] overflow-y-auto rounded-md border border-border bg-background p-3 text-sm md:text-ui">
            <Markdown text={card.plan} />
          </div>
        ) : (
          <p className="text-ui text-muted-foreground">Der Agent hat keinen Plantext mitgeschickt.</p>
        )}
        {revise ? (
          <HintEditor
            label="Was soll am Plan anders werden?"
            submitLabel="Überarbeiten lassen"
            value={hint}
            onChange={setHint}
            onSubmit={() => decide(card, "deny", planReviseReason(hint))}
            onCancel={() => setRevise(false)}
          />
        ) : null}
      </div>
      <div className="hidden flex-wrap items-center gap-2 border-t border-border px-3 py-2.5 md:flex">
        <Button variant="primary" onClick={() => decide(card, "allow")}>
          <Check aria-hidden />
          Plan freigeben
        </Button>
        {!revise ? (
          <Button variant="outline" onClick={() => (isMobile ? openHint(card) : setRevise(true))}>
            Überarbeiten …
          </Button>
        ) : null}
        <Button variant="ghost" onClick={() => decide(card, "deny", PLAN_REJECT_REASON)}>
          Ablehnen
        </Button>
      </div>
    </Card>
  );
}

export interface PlanDraft {
  sid: string;
  prompt: string;
  workers: OrchestraWorkerInfo[];
  subtasks: PlannedSubtask[];
  roles: { id: string; name: string; editsFiles?: boolean }[];
}

/** Hybrid orchestration: the Dirigent's plan, editable before it runs. */
export function OrchestraPlanCard({
  plan,
  onChange,
  onRun,
  onCancel,
  busy,
}: {
  plan: PlanDraft;
  onChange: (subtasks: PlannedSubtask[]) => void;
  onRun: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const titleId = React.useId();
  const index = new Map(plan.subtasks.map((s, i) => [s.id, i + 1]));
  const invalid = plan.subtasks.filter((st) => {
    const w = plan.workers.find((x) => x.id === st.workerId);
    return st.editsFiles && w && !w.editsFiles;
  }).length;
  return (
    <Card role="region" aria-labelledby={titleId} className="overflow-hidden border-primary-border shadow-sm" id="orchestra-plan">
      <div className="flex flex-wrap items-center gap-2 border-b border-primary-border bg-primary-subtle px-3 py-2">
        <Network aria-hidden className="size-4 shrink-0 text-primary-text" />
        <h2 id={titleId} className="text-ui font-semibold text-foreground">
          Plan prüfen und Modelle zuweisen
        </h2>
        <span className="text-xs text-muted-foreground">{plan.subtasks.length === 1 ? "1 Teilaufgabe" : `${plan.subtasks.length} Teilaufgaben`}</span>
      </div>
      <ol className="divide-y divide-border">
        {plan.subtasks.map((st, i) => {
          const role = st.roleId ? plan.roles.find((r) => r.id === st.roleId) : undefined;
          const current = plan.workers.find((w) => w.id === st.workerId);
          const wrong = st.editsFiles && current && !current.editsFiles;
          const deps = st.dependsOn.map((d) => index.get(d)).filter((n): n is number => !!n);
          return (
            <li key={st.id} className="grid gap-2 px-3 py-2.5 md:grid-cols-[minmax(0,1fr)_minmax(12rem,16rem)] md:items-start">
              <div className="flex min-w-0 gap-2">
                <span className="mt-px w-5 shrink-0 text-right text-ui tabular-nums text-subtle-foreground">{i + 1}.</span>
                <div className="min-w-0 space-y-1">
                  <div className="text-sm font-medium [overflow-wrap:anywhere] md:text-ui">{st.title || `Teilaufgabe ${i + 1}`}</div>
                  {st.description ? <p className="line-clamp-3 text-xs text-muted-foreground">{st.description}</p> : null}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {st.roleId ? <RoleChip roleId={st.roleId} name={role?.name} /> : null}
                    {st.editsFiles ? <span className="text-xs text-subtle-foreground">ändert Dateien</span> : null}
                    {deps.length ? <span className="text-xs text-subtle-foreground">nach {deps.join(", ")}</span> : null}
                  </div>
                </div>
              </div>
              <div className="min-w-0 space-y-1 pl-7 md:pl-0">
                <SimpleSelect
                  aria-label={`Modell für Teilaufgabe ${i + 1}`}
                  aria-invalid={wrong || undefined}
                  value={st.workerId}
                  onValueChange={(v) => onChange(plan.subtasks.map((x) => (x.id === st.id ? { ...x, workerId: v } : x)))}
                  options={plan.workers.map((w) => ({
                    value: w.id,
                    label: workerLabel(w),
                    disabled: st.editsFiles && !w.editsFiles && w.id !== st.workerId,
                    description: st.editsFiles && !w.editsFiles ? "Kann keine Dateien ändern" : undefined,
                  }))}
                />
                {wrong ? <p className="text-xs text-danger">Kann keine Dateien ändern</p> : null}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2.5">
        <Button variant="primary" onClick={onRun} loading={busy}>
          <Play aria-hidden />
          Plan ausführen
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Abbrechen
        </Button>
        {invalid ? (
          <span className="ml-auto text-xs text-warning">
            {invalid === 1 ? "1 Teilaufgabe" : `${invalid} Teilaufgaben`} mit einem Modell, das keine Dateien ändern kann
          </span>
        ) : null}
      </div>
    </Card>
  );
}
