"use client";

import Link from "next/link";
import { AudioWaveform, Network } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { ProviderMark, providerTone } from "@/components/ui/provider-mark";
import { Skeleton } from "@/components/ui/skeleton";
import { conductorAssignment, presetLabel, roleAssignment, workerShortLabel, type AssignmentView } from "./derive";
import { RoleChip } from "./role-chip";
import { useOrchestraConfig } from "./use-orchestra-config";

export interface OrchestraSummaryCardProps {
  variant: "settings" | "home";
  className?: string;
}

function ModelText({ a, short }: { a: AssignmentView; short?: boolean }) {
  if (a.unavailable) return <span className="truncate text-warning">‚{a.configuredId}‘ nicht verfügbar</span>;
  if (a.auto) {
    return (
      <span className="truncate text-muted-foreground">
        Automatisch{a.worker ? ` · ${short ? workerShortLabel(a.worker) : a.label.replace(/^Automatisch · /, "")}` : ""}
      </span>
    );
  }
  if (a.worker) return <ProviderMark tone={providerTone(a.worker.kind)} label={short ? workerShortLabel(a.worker) : a.label} className="text-muted-foreground" />;
  return <span className="truncate text-muted-foreground">{a.label}</span>;
}

/**
 * The current Besetzung at a glance: preset label, the Dirigent and the
 * enabled roles with their models, and a way into /orchestra.
 */
export function OrchestraSummaryCard({ variant, className }: OrchestraSummaryCardProps) {
  const { config, workers, error, reload } = useOrchestraConfig();
  const isHome = variant === "home";
  const action = (
    <Button asChild variant={isHome ? "ghost" : "outline"} size="sm">
      <Link href="/orchestra">{isHome ? "Bearbeiten" : "Organigramm öffnen"}</Link>
    </Button>
  );

  if (error && !config) {
    return (
      <Callout
        variant="danger"
        title="Orchester konnte nicht geladen werden"
        className={className}
        action={
          <Button size="sm" variant="outline" onClick={() => void reload()}>
            Erneut versuchen
          </Button>
        }
      >
        {error}
      </Callout>
    );
  }

  if (!config) {
    return (
      <Card className={cn("p-4", className)} aria-busy>
        <span className="sr-only" role="status">
          Orchester wird geladen …
        </span>
        <div className="flex items-center gap-2.5">
          <Skeleton className="size-8 rounded-lg" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-3 w-40" />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {[16, 20, 18, 14].map((w, i) => (
            <Skeleton key={i} className="h-5 rounded-full" style={{ width: `${w * 4}px` }} />
          ))}
        </div>
      </Card>
    );
  }

  const enabled = config.roles.filter((r) => r.enabled);
  const off = config.roles.length - enabled.length;
  const conductor = conductorAssignment(config, workers);

  if (isHome) {
    return (
      <Card className={cn("p-4", className)}>
        <div className="flex items-start gap-2.5">
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary-subtle text-primary-text [&_svg]:size-4">
            <Network />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-ui font-semibold text-foreground">Orchester</h3>
            <p className="truncate text-xs text-muted-foreground">Besetzung: {presetLabel(config)}</p>
          </div>
          {action}
        </div>
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Rollen">
          <li>
            <span className="inline-flex h-5 items-center gap-1 rounded-full border border-primary-border bg-primary-subtle px-2 text-xs font-medium text-primary-text">
              <AudioWaveform aria-hidden className="size-3" />
              Dirigent
              <span className="font-normal text-muted-foreground">· {conductor.worker ? workerShortLabel(conductor.worker) : conductor.label}</span>
            </span>
          </li>
          {enabled.map((role) => {
            const a = roleAssignment(role, config, workers);
            return (
              <li key={role.id} className="min-w-0 max-w-full">
                <RoleChip roleId={role.id} config={config} detail={a.unavailable ? "nicht verfügbar" : a.auto ? "Automatisch" : a.worker ? workerShortLabel(a.worker) : a.label} />
              </li>
            );
          })}
        </ul>
        {off ? <p className="mt-2 text-xs text-subtle-foreground">{off === 1 ? "1 Rolle aus" : `${off} Rollen aus`}</p> : null}
      </Card>
    );
  }

  return (
    <Card className={cn("p-4", className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">Besetzung</p>
          <p className="truncate text-sm font-medium text-foreground md:text-ui">{presetLabel(config)}</p>
        </div>
        {action}
      </div>
      <ul className="mt-3 divide-y divide-border rounded-md border border-border" aria-label="Rollen und Modelle">
        <li className="flex min-h-10 items-center gap-3 px-3 py-1.5 text-ui">
          <span className="inline-flex w-36 shrink-0 items-center gap-1.5 font-medium text-foreground">
            <AudioWaveform aria-hidden className="size-3.5 text-primary-text" />
            Dirigent
          </span>
          <span className="min-w-0 flex-1 truncate">
            <ModelText a={conductor} />
          </span>
        </li>
        {enabled.map((role) => (
          <li key={role.id} className="flex min-h-10 items-center gap-3 px-3 py-1.5 text-ui">
            <span className="w-36 shrink-0">
              <RoleChip roleId={role.id} config={config} />
            </span>
            <span className="min-w-0 flex-1 truncate">
              <ModelText a={roleAssignment(role, config, workers)} />
            </span>
            <span className="hidden shrink-0 text-xs text-subtle-foreground sm:inline">
              {role.editsFiles ? "darf Dateien ändern" : "nur lesen"}
            </span>
          </li>
        ))}
      </ul>
      {off ? <p className="mt-2 text-xs text-subtle-foreground">{off === 1 ? "1 Rolle ist aus." : `${off} Rollen sind aus.`}</p> : null}
    </Card>
  );
}
