"use client";

import { useBuilderStore } from "@/stores/builder-store";
import type { SwarmConfig, SwarmAgentRole } from "@/lib/ai/types";
import { Plus, Trash2 } from "lucide-react";
import { Field, FieldLabel } from "@/components/ui/field";
import { SimpleSelect } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button, IconButton } from "@/components/ui/button";
import { SwitchRow } from "@/components/ui/switch";
import { updateDraft } from "./draft-sync";

// The starting roles; names and descriptions end up in the prompt's
// <swarm-config> and can be renamed in the panel.
const defaultSwarmConfig: SwarmConfig = {
  topology: "hierarchical",
  agentCount: 4,
  agentRoles: [
    { type: "architect", name: "Architekt", description: "Systementwurf und Planung" },
    { type: "coder", name: "Coder", description: "Umsetzung" },
    { type: "reviewer", name: "Reviewer", description: "Code-Review" },
    { type: "tester", name: "Tester", description: "Tests schreiben und prüfen" },
  ],
  coordinationStrategy: "majority",
  memoryScope: "project",
};

const TOPOLOGY_OPTIONS: { value: SwarmConfig["topology"]; label: string; description: string }[] = [
  { value: "hierarchical", label: "Hierarchisch", description: "Ein Koordinator (Queen) verteilt an die übrigen Agenten" },
  { value: "mesh", label: "Mesh", description: "Alle Agenten sprechen direkt miteinander" },
  { value: "ring", label: "Ring", description: "Ergebnisse wandern reihum" },
  { value: "star", label: "Stern", description: "Ein Hub koordiniert alle" },
];

const COORDINATION_OPTIONS: { value: SwarmConfig["coordinationStrategy"]; label: string; description: string }[] = [
  { value: "majority", label: "Mehrheitsentscheid", description: "Jede Stimme zählt gleich" },
  { value: "weighted", label: "Gewichtet", description: "Der Koordinator zählt dreifach" },
  { value: "byzantine", label: "Byzantinische Fehlertoleranz", description: "Robust gegen fehlerhafte Agenten" },
];

const MEMORY_OPTIONS: { value: SwarmConfig["memoryScope"]; label: string }[] = [
  { value: "project", label: "Projekt" },
  { value: "local", label: "Lokal" },
  { value: "user", label: "Benutzer" },
];

const ROLE_LABEL: Record<SwarmAgentRole["type"], string> = {
  researcher: "Recherche",
  coder: "Coder",
  analyst: "Analyse",
  tester: "Tester",
  architect: "Architekt",
  reviewer: "Reviewer",
  optimizer: "Optimierer",
  documenter: "Doku",
  custom: "Eigene",
};

const ROLE_OPTIONS = (Object.keys(ROLE_LABEL) as SwarmAgentRole["type"][]).map((t) => ({ value: t, label: ROLE_LABEL[t] }));

/** „Mehrere Agenten (Schwarm)" inside the builder's „Erweitert" section. */
export function SwarmConfigPanel() {
  const config = useBuilderStore((s) => s.structured.swarmConfig);

  // Through updateDraft, against the current draft: on Vorschau and
  // Verfeinern the change is applied to the XML at once.
  function setSwarmConfig(next: SwarmConfig | undefined) {
    updateDraft(() => ({ swarmConfig: next }));
  }

  function update(fn: (c: SwarmConfig) => Partial<SwarmConfig>) {
    updateDraft((cur) => (cur.swarmConfig ? { swarmConfig: { ...cur.swarmConfig, ...fn(cur.swarmConfig) } } : null));
  }

  function addRole() {
    update((c) => ({
      agentRoles: [...c.agentRoles, { type: "custom", name: `Agent ${c.agentRoles.length + 1}`, description: "" }],
      agentCount: c.agentCount + 1,
    }));
  }

  function removeRole(idx: number) {
    update((c) => {
      const roles = c.agentRoles.filter((_, i) => i !== idx);
      return { agentRoles: roles, agentCount: Math.max(roles.length, 1) };
    });
  }

  function updateRole(idx: number, patch: Partial<SwarmAgentRole>) {
    update((c) => ({ agentRoles: c.agentRoles.map((r, i) => (i === idx ? { ...r, ...patch } : r)) }));
  }

  return (
    <div className="space-y-3">
      <SwitchRow
        label="Mehrere Agenten (Schwarm)"
        description="Ergänzt den Prompt um eine Schwarm-Konfiguration nach dem Muster von ruflo: Topologie, Koordination, Gedächtnis und Rollen."
        checked={!!config}
        onCheckedChange={(on) => setSwarmConfig(on ? { ...defaultSwarmConfig } : undefined)}
      />

      {config ? (
        <div className="space-y-3">
          <Field>
            <FieldLabel>Topologie</FieldLabel>
            <SimpleSelect
              options={TOPOLOGY_OPTIONS}
              value={config.topology}
              onValueChange={(v) => update(() => ({ topology: v as SwarmConfig["topology"] }))}
            />
          </Field>
          <Field>
            <FieldLabel>Koordination</FieldLabel>
            <SimpleSelect
              options={COORDINATION_OPTIONS}
              value={config.coordinationStrategy}
              onValueChange={(v) => update(() => ({ coordinationStrategy: v as SwarmConfig["coordinationStrategy"] }))}
            />
          </Field>
          <Field>
            <FieldLabel>Gedächtnis</FieldLabel>
            <SimpleSelect
              options={MEMORY_OPTIONS}
              value={config.memoryScope}
              onValueChange={(v) => update(() => ({ memoryScope: v as SwarmConfig["memoryScope"] }))}
            />
          </Field>

          <div role="group" aria-labelledby="pb-swarm-roles" className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span id="pb-swarm-roles" className="text-sm font-medium md:text-ui">
                Rollen <span className="font-normal tabular-nums text-subtle-foreground">({config.agentRoles.length})</span>
              </span>
              <Button variant="ghost" size="sm" onClick={addRole}>
                <Plus aria-hidden /> Rolle
              </Button>
            </div>
            <ul className="space-y-2">
              {config.agentRoles.map((role, idx) => (
                <li key={idx} className="flex items-center gap-1.5">
                  <SimpleSelect
                    aria-label={`Typ von Rolle ${idx + 1}`}
                    options={ROLE_OPTIONS}
                    value={role.type}
                    onValueChange={(v) => updateRole(idx, { type: v as SwarmAgentRole["type"] })}
                    className="w-28 shrink-0"
                  />
                  <Input
                    aria-label={`Name von Rolle ${idx + 1}`}
                    value={role.name}
                    onChange={(e) => updateRole(idx, { name: e.target.value })}
                    placeholder="Name"
                  />
                  <IconButton
                    aria-label={`Rolle ${idx + 1} entfernen`}
                    variant="danger-ghost"
                    className="shrink-0"
                    onClick={() => removeRole(idx)}
                  >
                    <Trash2 />
                  </IconButton>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
