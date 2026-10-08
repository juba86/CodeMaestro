"use client";

import { useMemo } from "react";
import { Field, FieldHint, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ModelPicker, type ModelPickerItem } from "@/components/ui/model-picker";
import { providerTone } from "@/components/ui/provider-mark";
import { SimpleSelect } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { getProvider } from "@/lib/ai/catalog";
import { PROVIDER_LIST } from "./provider-status";
import { Code, SectionHeader, SettingsCard } from "./settings-ui";
import type { ProviderSetup } from "./use-provider-setup";

export function ModelsSection({ setup }: { setup: ProviderSetup }) {
  const { activeProvider, activeModel, models, modelsLoading } = setup;
  const configured = useMemo(() => new Set(setup.summary.ids), [setup.summary.ids]);
  const providerName = getProvider(activeProvider)?.label ?? activeProvider;

  const providerOptions = PROVIDER_LIST.map((p) => ({
    value: p.id,
    label: p.label,
    description: configured.has(p.id) ? undefined : "nicht eingerichtet",
  }));

  const items = useMemo<ModelPickerItem[]>(() => {
    const tone = providerTone(activeProvider);
    const list: ModelPickerItem[] = models.map((m) => ({ id: m.id, label: m.name, sublabel: m.name !== m.id ? m.id : undefined, group: providerName, tone }));
    // Keep a manually entered model id (not in the discovered list) selectable.
    if (activeModel && !models.some((m) => m.id === activeModel)) {
      list.unshift({ id: activeModel, label: activeModel, sublabel: "eigene Modell-ID", group: "Eigene", tone });
    }
    return list;
  }, [models, activeModel, activeProvider, providerName]);

  const emptyText =
    activeProvider === "ollama" ? "Keine Ollama-Modelle gefunden – läuft der Daemon?" : "Keine Modelle verfügbar – Provider einrichten oder Modell-ID eingeben.";

  return (
    <div>
      <SectionHeader
        title="Standardmodell"
        description="Gilt für Builder, Playground und die Verfeinerung von Prompts auf diesem Gerät. Agenten im Assistenten wählst du pro Session."
      />
      <SettingsCard>
        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel>Aktiver Provider</FieldLabel>
            <SimpleSelect options={providerOptions} value={activeProvider} onValueChange={setup.selectProvider} />
          </Field>

          {items.length > 0 ? (
            <Field>
              <FieldLabel>Modell</FieldLabel>
              <ModelPicker
                title={`Modell für ${providerName}`}
                items={items}
                value={activeModel}
                onValueChange={setup.setActiveModel}
                placeholder="Modell wählen"
                className="w-full"
              />
            </Field>
          ) : (
            // No list to pick from (yet): a plain caption, not a label without a control.
            <div className="grid gap-1.5">
              <p className="text-sm font-medium text-foreground md:text-ui">Modell</p>
              {modelsLoading ? (
                <>
                  <Skeleton className="h-10 w-full md:h-8" />
                  <span className="sr-only" role="status">
                    Modelle werden geladen …
                  </span>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">{emptyText}</p>
              )}
            </div>
          )}

          <Field>
            <FieldLabel>Modell-ID direkt eingeben</FieldLabel>
            <Input
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
              placeholder="z. B. gpt-oss:120b-cloud"
              value={activeModel}
              onChange={(e) => setup.setActiveModel(e.target.value)}
            />
            <FieldHint>
              Praktisch für Ollama-Cloud-Modelle (Endung <Code>-cloud</Code>) oder neue Modelle, die noch nicht in der Liste
              erscheinen. Mit gesetztem API-Key wird die Live-Liste von <Code>ollama.com</Code> automatisch geladen.
            </FieldHint>
          </Field>
        </div>
      </SettingsCard>
    </div>
  );
}
