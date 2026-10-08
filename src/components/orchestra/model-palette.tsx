"use client";

import * as React from "react";
import Link from "next/link";
import { AudioWaveform, Check, Cloud, FilePen, GripVertical, HardDrive, RefreshCw, Search, Sparkles, type LucideIcon } from "lucide-react";
import type { OrchestraWorkerInfo } from "@/lib/assistant/orchestra-types";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { cn } from "@/components/ui/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { InputGroup } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { ProviderDot, providerTone } from "@/components/ui/provider-mark";
import { Skeleton } from "@/components/ui/skeleton";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { useOrchestraPage } from "./context";
import {
  costHint,
  groupWorkers,
  usageCounts,
  workerBlurb,
  workerLabel,
  workerParts,
  type WorkerGroupId,
} from "./derive";
import { CONDUCTOR_TARGET } from "./edit";
import { RoleIcon } from "./role-chip";

const GROUP_ICON: Record<WorkerGroupId, LucideIcon> = {
  agents: FilePen,
  "local-text": HardDrive,
  "cloud-text": Cloud,
};

export const PROVIDERS_HREF = "/settings?section=providers";

/** „Zuweisen an …": Dirigent and every role; incompatible roles disabled with their reason. */
function AssignMenuItems({ worker }: { worker: OrchestraWorkerInfo }) {
  const { editor } = useOrchestraPage();
  const draft = editor.draft!;
  return (
    <>
      <DropdownMenuLabel>Zuweisen an …</DropdownMenuLabel>
      <DropdownMenuItem onSelect={() => editor.assign(CONDUCTOR_TARGET, worker.id)}>
        <AudioWaveform />
        <span className="min-w-0 flex-1 truncate">Dirigent</span>
        {draft.conductor.workerId === worker.id ? <Check aria-label="zugewiesen" className="text-primary-text!" /> : null}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      {draft.roles.map((role) => {
        const blocked = role.editsFiles && !worker.editsFiles;
        return (
          <DropdownMenuItem key={role.id} disabled={blocked} onSelect={() => editor.assign(role.id, worker.id)}>
            <RoleIcon of={role} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">
                {role.name.trim() || role.id}
                {role.enabled ? "" : " (aus)"}
              </span>
              {blocked ? <span className="text-xs text-muted-foreground">Kann keine Dateien ändern</span> : null}
            </span>
            {role.workerId === worker.id ? <Check aria-label="zugewiesen" className="text-primary-text!" /> : null}
          </DropdownMenuItem>
        );
      })}
    </>
  );
}

function ModelChip({ worker, count }: { worker: OrchestraWorkerInfo; count: number }) {
  const { drag, readOnly: noConfig, editor } = useOrchestraPage();
  // Until the configuration is loaded there is nothing to assign to.
  const readOnly = noConfig || !editor.draft;
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [tipOpen, setTipOpen] = React.useState(false);
  const { name, detail } = workerParts(worker);
  const hint = costHint(worker);
  const isSource = !!drag.dragging && drag.dragging.from === "palette" && drag.dragging.workerId === worker.id;
  const tooltip = (
    <div className="max-w-64 space-y-1 py-0.5">
      <p className="font-medium">{workerLabel(worker)}</p>
      <p className="text-muted-foreground">
        {workerBlurb(worker)} · {worker.editsFiles ? "darf Dateien ändern" : "liefert nur Text"}
      </p>
      {worker.strengths ? (
        <p className="text-muted-foreground">
          <span className="text-foreground">Profil für den Dirigenten:</span> <span lang="en">{worker.strengths}</span>
        </p>
      ) : null}
      {count ? <p>{count}× eingesetzt</p> : null}
    </div>
  );
  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <SimpleTooltip content={tooltip} side="right" open={tipOpen && !menuOpen && !drag.dragging} onOpenChange={setTipOpen}>
        <DropdownMenuTrigger asChild disabled={readOnly}>
          <button
            type="button"
            aria-label={`${workerLabel(worker)}, ${hint}${count ? `, ${count}× eingesetzt` : ""}. Zuweisen an …`}
            {...drag.startProps({ workerId: worker.id, from: "palette" }, { preventDefault: true, disabled: readOnly })}
            onClick={() => {
              if (drag.consumeClick()) return;
              setMenuOpen(true);
            }}
            className={cn(
              "flex w-full min-w-0 select-none items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-left text-ui text-foreground",
              "transition-colors duration-150 hover:border-border-strong hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              "data-[state=open]:border-primary-border data-[state=open]:bg-primary-subtle md:cursor-grab",
              "disabled:cursor-not-allowed disabled:opacity-50",
              isSource && "border-dashed border-primary-border bg-primary-subtle opacity-70",
            )}
          >
            <GripVertical aria-hidden className="size-3.5 shrink-0 text-subtle-foreground" />
            <ProviderDot tone={providerTone(worker.kind)} />
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">{name}</span>
              {detail ? <span className="text-muted-foreground"> {detail}</span> : null}
            </span>
            {count ? (
              <span className="shrink-0 rounded-sm bg-surface-2 px-1 text-xs tabular-nums text-muted-foreground">{count}×</span>
            ) : null}
            <span className="shrink-0 text-xs text-subtle-foreground">{hint === "frei per Login" ? "frei" : hint}</span>
          </button>
        </DropdownMenuTrigger>
      </SimpleTooltip>
      <DropdownMenuContent side="right" align="start" className="w-64">
        <AssignMenuItems worker={worker} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** „Kein Modell verfügbar." with the way to the provider settings (§6.3.9). */
export function NoModelsState({
  className,
  headingLevel = 2,
  compact = false,
}: {
  className?: string;
  headingLevel?: 2 | 3;
  compact?: boolean;
}) {
  return (
    <EmptyState
      className={className}
      icon={<Sparkles />}
      title="Kein Modell verfügbar."
      description="Richte Claude Code, Gemini CLI, Ollama oder einen API-Key ein."
      headingLevel={headingLevel}
      action={
        <Button asChild size={compact ? "sm" : "md"} variant="outline">
          <Link href={PROVIDERS_HREF}>Zu den Providern</Link>
        </Button>
      }
    />
  );
}

/** Left column (≥1024): models grouped by capability, draggable and menu-assignable. */
export function ModelPalette() {
  const { editor, drag, readOnly } = useOrchestraPage();
  const [query, setQuery] = React.useState("");
  const workers = editor.workers;
  const counts = editor.draft ? usageCounts(editor.draft) : {};
  const q = query.trim().toLowerCase();
  const filtered = (workers ?? []).filter(
    (w) => !q || workerLabel(w).toLowerCase().includes(q) || w.id.toLowerCase().includes(q) || costHint(w).toLowerCase().includes(q),
  );
  const groups = groupWorkers(filtered);
  const slotDrag = !!drag.dragging && typeof drag.dragging.from === "object";
  const over = drag.over?.key === "palette";

  return (
    <aside
      aria-labelledby="orchestra-palette-title"
      data-drop-target={slotDrag ? "palette" : undefined}
      className={cn(
        "relative flex w-64 shrink-0 flex-col border-r border-border bg-surface",
        over && "outline-2 -outline-offset-4 outline-dashed outline-primary",
      )}
    >
      <div className="space-y-2 p-3">
        <h2 id="orchestra-palette-title" className="text-xs font-semibold text-foreground">
          Modelle
        </h2>
        <InputGroup
          size="sm"
          leading={<Search />}
          placeholder="Filtern …"
          aria-label="Modelle filtern"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={!workers?.length}
        />
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-3">
        {workers === null && editor.workersLoading ? (
          <div className="space-y-1.5" role="status">
            <p className="text-xs text-muted-foreground">prüfe Modelle …</p>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : workers === null && editor.workersError ? (
          <Callout
            variant="danger"
            className="p-2.5 text-xs"
            action={
              <Button size="xs" variant="outline" onClick={() => void editor.reloadWorkers()}>
                Erneut versuchen
              </Button>
            }
          >
            {editor.workersError}
          </Callout>
        ) : workers && workers.length === 0 ? (
          <NoModelsState className="px-1 py-6" headingLevel={3} compact />
        ) : q && !groups.length ? (
          <p className="px-1 py-4 text-center text-xs text-muted-foreground">Kein Modell passt zum Filter.</p>
        ) : (
          groups.map((g) => {
            const Icon = GROUP_ICON[g.id];
            return (
              <section key={g.id} aria-label={g.label}>
                <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Icon aria-hidden className="size-3.5" />
                  {g.label}
                </h3>
                <ul className="space-y-1">
                  {g.workers.map((w) => (
                    <li key={w.id}>
                      <ModelChip worker={w} count={counts[w.id] ?? 0} />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </div>
      <div className="space-y-2 border-t border-border px-3 py-2.5 text-xs text-muted-foreground">
        <p>
          Auf eine Rolle ziehen – oder Modell wählen und <Kbd>Enter</Kbd> → „Zuweisen an …“
        </p>
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <Link
            href={PROVIDERS_HREF}
            className="rounded-sm text-primary-text underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Weitere Modelle in Einstellungen → Provider
          </Link>
          <Button
            size="xs"
            variant="ghost"
            loading={editor.workersLoading}
            disabled={readOnly}
            onClick={() => void editor.reloadWorkers()}
            className="-mr-1"
          >
            {editor.workersLoading ? null : <RefreshCw />}
            Neu prüfen
          </Button>
        </div>
      </div>
      {slotDrag ? (
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-x-3 bottom-24 rounded-md border border-dashed px-2 py-2 text-center text-xs",
            over ? "border-primary bg-primary-subtle text-primary-text" : "border-border-strong bg-card text-muted-foreground",
          )}
        >
          Hier loslassen: zurück auf Automatisch
        </div>
      ) : null}
    </aside>
  );
}
