// ModelPicker items for the orchestra (capability filter, German blurbs).

import type { OrchestraRole, OrchestraWorkerInfo } from "@/lib/assistant/orchestra-types";
import type { ModelPickerItem } from "@/components/ui/model-picker";
import { providerTone } from "@/components/ui/provider-mark";
import { WORKER_GROUP_LABEL, costHint, workerBlurb, workerGroupOf, workerLabel } from "./derive";

export function pickerItems(workers: readonly OrchestraWorkerInfo[] | null): ModelPickerItem[] {
  return (workers ?? []).map((w) => ({
    id: w.id,
    label: workerLabel(w),
    sublabel: workerBlurb(w),
    group: WORKER_GROUP_LABEL[workerGroupOf(w)],
    tone: providerTone(w.kind),
    editsFiles: w.editsFiles,
    costTier: costHint(w),
  }));
}

/** Roles that change files only see file-capable models (until „trotzdem zeigen"). */
export function capabilityFilter(role: Pick<OrchestraRole, "editsFiles"> | null) {
  if (!role?.editsFiles) return undefined;
  return (item: ModelPickerItem) => (item.editsFiles ? null : "Kann keine Dateien ändern");
}

export function capabilityHint(role: Pick<OrchestraRole, "editsFiles" | "name"> | null): string | undefined {
  if (!role?.editsFiles) return undefined;
  return `${role.name.trim() || "Diese Rolle"} darf Dateien ändern – nur passende Modelle werden angezeigt.`;
}

export const hiddenTextModels = (n: number) =>
  n === 1 ? "1 Modell nur mit Text ausgeblendet" : `${n} Modelle nur mit Text ausgeblendet`;

/** „Modell für ‚Tester‘". */
export const pickerTitle = (name: string) => `Modell für ‚${name.trim() || "Rolle"}‘`;
