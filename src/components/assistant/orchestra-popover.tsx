"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, ChevronRight } from "lucide-react";
import { RoleChip, conductorAssignment, presetLabel, useOrchestraConfig, workerLabel } from "@/components/orchestra";
import { cn } from "@/components/ui/cn";
import { Field, FieldHint, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { SwitchRow } from "@/components/ui/switch";
import type { ProjectContext, RoutingPreference } from "./composer-logic";

/** „Orchester · Ausgewogen" (loads the shared orchestra config). */
export function OrchestraModeLabel() {
  const { config } = useOrchestraConfig();
  return <>{config ? `Orchester · ${presetLabel(config)}` : "Orchester"}</>;
}

/**
 * Orchester settings of the composer (DESIGN.md §6.2.5): the Besetzung, the
 * Dirigent (Automatisch = the orchestra's own conductor), plan approval and
 * the optional project context.
 */
export function OrchestraSettings({
  planApproval,
  onPlanApproval,
  conductor,
  onConductor,
  context,
  onContext,
}: {
  planApproval: boolean;
  onPlanApproval: (v: boolean) => void;
  /** "" = Automatisch (laut Orchester); else an explicitly chosen worker id. */
  conductor: string;
  onConductor: (id: string) => void;
  context: ProjectContext;
  onContext: (c: ProjectContext) => void;
}) {
  const { config, workers, loading, error } = useOrchestraConfig();
  const [ctxOpen, setCtxOpen] = React.useState(Boolean(context.stack || context.constraints || context.verify || context.routing !== "balanced"));
  const roles = config?.roles.filter((r) => r.enabled) ?? [];
  const auto = config ? conductorAssignment(config, workers) : null;
  const options = [
    { value: "", label: "Automatisch (laut Orchester)", description: auto ? `Dirigent: ${auto.label}` : undefined },
    ...(workers ?? []).map((w) => ({ value: w.id, label: workerLabel(w) })),
  ];
  // A pick that is no longer available falls back to Automatisch.
  const value = conductor && workers && !workers.some((w) => w.id === conductor) ? "" : conductor;

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-ui font-medium">Besetzung</span>
          {config ? <span className="text-ui text-muted-foreground">{presetLabel(config)}</span> : null}
        </div>
        {loading && !config ? (
          <div className="flex gap-1.5">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-5 w-14 rounded-full" />
          </div>
        ) : error ? (
          <p className="text-ui text-danger">{error}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {roles.length ? roles.map((r) => <RoleChip key={r.id} roleId={r.id} config={config} />) : (
              <span className="text-ui text-muted-foreground">Keine Rollen aktiv – der Dirigent verteilt direkt an Modelle.</span>
            )}
          </div>
        )}
      </div>
      <Field>
        <FieldLabel>Dirigent</FieldLabel>
        <SimpleSelect value={value} onValueChange={onConductor} options={options} placeholder="Automatisch (laut Orchester)" />
        {value === "" && auto ? <FieldHint>Laut Orchester: {auto.label}</FieldHint> : null}
      </Field>
      <SwitchRow
        label="Plan vor Ausführung freigeben"
        description="Erst planen, dann Teilaufgaben und Modelle prüfen."
        checked={planApproval}
        onCheckedChange={onPlanApproval}
      />
      <div className="rounded-md border border-border">
        <button
          type="button"
          aria-expanded={ctxOpen}
          onClick={() => setCtxOpen((v) => !v)}
          className="flex min-h-10 w-full items-center gap-2 px-2.5 text-left text-ui font-medium hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-ring md:min-h-8"
        >
          <ChevronRight aria-hidden className={cn("size-4 text-subtle-foreground transition-transform", ctxOpen && "rotate-90")} />
          Projektkontext
          <span className="font-normal text-subtle-foreground">optional</span>
        </button>
        {ctxOpen ? (
          <div className="space-y-3 border-t border-border p-2.5">
            <Field>
              <FieldLabel>Stack</FieldLabel>
              <Input placeholder="z. B. Next.js + TypeScript" value={context.stack} maxLength={300} onChange={(e) => onContext({ ...context, stack: e.target.value })} />
            </Field>
            <Field>
              <FieldLabel>Vorgaben</FieldLabel>
              <Input
                placeholder="Rahmenbedingungen, No-Gos"
                value={context.constraints}
                maxLength={600}
                onChange={(e) => onContext({ ...context, constraints: e.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel>Modellwahl</FieldLabel>
              <SimpleSelect
                value={context.routing}
                onValueChange={(v) => onContext({ ...context, routing: v as RoutingPreference })}
                options={[
                  { value: "balanced", label: "Ausgewogen" },
                  { value: "quality", label: "Beste Qualität bevorzugen" },
                  { value: "local", label: "Lokal & günstig bevorzugen" },
                ]}
              />
            </Field>
            <SwitchRow
              label="Ergebnis prüfen lassen"
              description="Fügt am Ende eine Test- bzw. Prüf-Teilaufgabe hinzu."
              checked={context.verify}
              onCheckedChange={(v) => onContext({ ...context, verify: v })}
            />
          </div>
        ) : null}
      </div>
      <Link
        href="/orchestra"
        className="inline-flex min-h-10 items-center gap-1 text-ui font-medium md:min-h-8 text-primary-text underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
      >
        Orchester bearbeiten
        <ArrowRight aria-hidden className="size-3.5" />
      </Link>
    </div>
  );
}
