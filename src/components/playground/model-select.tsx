"use client";

import { useEffect, useState } from "react";
import { fetchModelsForProvider } from "@/lib/ai/client-keys";
import { PROVIDERS } from "@/lib/ai/catalog";
import type { ModelInfo, ProviderName } from "@/lib/ai/types";
import { Field, FieldLabel } from "@/components/ui/field";
import { SimpleSelect } from "@/components/ui/select";
import { cn } from "@/components/ui/cn";

export const PROVIDER_OPTIONS = PROVIDERS.map((p) => ({ value: p.id, label: p.label }));

/**
 * Provider + model pickers for one run target. The model list is fetched per
 * provider (including dynamically discovered local Ollama models); a model id
 * that isn't listed (typed in Settings) stays selectable as „eigene".
 */
export function ModelSelect({
  provider,
  model,
  onChange,
  label,
  className,
}: {
  provider: ProviderName;
  model: string;
  onChange: (next: { provider: ProviderName; model: string }) => void;
  /** Prefix for the field labels (screen readers only), e.g. "Spalte 2". */
  label?: string;
  className?: string;
}) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetchModelsForProvider(provider, controller.signal)
      .then((m) => {
        setModels(m);
        // Only fill an empty selection: an unlisted id is usually typed on
        // purpose (new/cloud models, see Settings).
        if (!model && m[0]) onChange({ provider, model: m[0].id });
      })
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // Refetch per provider only; `model`/`onChange` are read at resolve time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  const options = [
    ...(model && !models.some((m) => m.id === model) ? [{ value: model, label: `${model} (eigene)` }] : []),
    ...models.map((m) => ({ value: m.id, label: m.name })),
  ];
  const prefix = label ? `${label}: ` : "";

  return (
    <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2", className)}>
      <Field>
        <FieldLabel>
          {prefix ? <span className="sr-only">{prefix}</span> : null}Anbieter
        </FieldLabel>
        <SimpleSelect
          options={PROVIDER_OPTIONS}
          value={provider}
          onValueChange={(v) => onChange({ provider: v as ProviderName, model: "" })}
        />
      </Field>
      <Field>
        <FieldLabel>
          {prefix ? <span className="sr-only">{prefix}</span> : null}Modell
        </FieldLabel>
        <SimpleSelect
          options={options}
          value={model}
          onValueChange={(v) => onChange({ provider, model: v })}
          placeholder={
            loading
              ? "Modelle werden geladen …"
              : provider === "ollama"
                ? "Keine Ollama-Modelle – läuft der Daemon?"
                : "Keine Modelle verfügbar"
          }
          disabled={options.length === 0}
        />
      </Field>
    </div>
  );
}
