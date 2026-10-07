"use client";

import * as React from "react";
import { ArrowLeftRight, ChevronDown, CircleAlert, PenOff, Plus, Sparkles, TriangleAlert } from "lucide-react";
import type { OrchestraRole } from "@/lib/assistant/orchestra-types";
import { cn } from "@/components/ui/cn";
import { ModelPicker } from "@/components/ui/model-picker";
import { ProviderDot, providerTone } from "@/components/ui/provider-mark";
import { useOrchestraPage } from "./context";
import { conductorAssignment, findWorker, roleAssignment, workerLabel, workerParts } from "./derive";
import { CONDUCTOR_TARGET } from "./edit";
import { capabilityFilter, capabilityHint, hiddenTextModels, pickerTitle } from "./model-items";
import { problemsFor } from "./problems";

/** The drop-target key of an assignment target ([data-drop-target]). */
export const dropKeyOf = (target: string) => (target === CONDUCTOR_TARGET ? "conductor" : `role:${target}`);

/**
 * The model slot of a card (§6.3.3): a 36px button that opens the ModelPicker
 * (the primary, non-drag path) and doubles as a drag source for its chip.
 */
export function ModelSlot({
  target,
  role,
  errorId,
}: {
  target: string;
  role: OrchestraRole | null;
  /** id of the inline capability message (aria-describedby). */
  errorId?: string;
}) {
  const { editor, items, drag, pickerFor, setPickerFor, readOnly } = useOrchestraPage();
  const draft = editor.draft!;
  const workers = editor.workers;
  const a = role ? roleAssignment(role, draft, workers) : conductorAssignment(draft, workers);
  const autoPick = role
    ? roleAssignment({ ...role, workerId: "" }, draft, workers)
    : conductorAssignment({ conductor: { ...draft.conductor, workerId: "" } }, workers);
  const capability = problemsFor(editor.problems, target).find((p) => p.capability && p.severity !== "info");
  const name = role ? role.name.trim() || role.id : "Dirigent";
  const key = dropKeyOf(target);
  const over = drag.over?.key === key ? drag.over : null;
  const dragging = drag.dragging;
  const isSource = !!dragging && typeof dragging.from === "object" && dragging.from.target === target;
  const draggedWorker = dragging ? findWorker(workers, dragging.workerId) : null;
  const incompatible = !!dragging && !!role?.editsFiles && !!draggedWorker && !draggedWorker.editsFiles;
  const canDrag = !readOnly && !a.auto && !!a.configuredId && !a.unavailable;

  let content: React.ReactNode;
  let tone = "border-border-strong";
  if (over) {
    tone = over.valid
      ? "border-2 border-dashed border-primary bg-primary-subtle text-primary-text"
      : "border-2 border-dashed border-danger bg-danger-subtle text-danger";
    content = over.valid ? (
      <>
        <Plus aria-hidden className="size-4 shrink-0" />
        <span className="truncate text-xs font-medium">Loslassen zum Zuweisen</span>
      </>
    ) : (
      <>
        <PenOff aria-hidden className="size-4 shrink-0" />
        <span className="truncate text-xs font-medium">{over.reason ?? "Kann keine Dateien ändern"}</span>
      </>
    );
  } else if (dragging && !isSource && a.auto && !incompatible) {
    tone = "border-dashed border-primary-border bg-primary-subtle/60 text-primary-text";
    content = (
      <>
        <Plus aria-hidden className="size-4 shrink-0" />
        <span className="truncate text-xs">Modell hierher ziehen oder tippen</span>
      </>
    );
  } else if (a.unavailable) {
    tone = "border-warning-border";
    content = (
      <>
        <TriangleAlert aria-hidden className="size-4 shrink-0 text-warning" />
        <span className="min-w-0 truncate">
          <span className="font-medium">‚{a.configuredId}‘</span>
          <span className="text-muted-foreground"> nicht verfügbar</span>
        </span>
      </>
    );
  } else if (a.auto) {
    tone = "border-dashed border-border-strong";
    content = (
      <>
        <Sparkles aria-hidden className="size-3.5 shrink-0 text-subtle-foreground" />
        <span className="min-w-0 truncate">
          Automatisch
          {a.worker ? <span className="text-muted-foreground"> · {workerLabel(a.worker)}</span> : null}
        </span>
      </>
    );
  } else if (a.worker) {
    const parts = workerParts(a.worker);
    tone = capability ? "border-danger" : "border-border-strong";
    content = (
      <>
        <ProviderDot tone={providerTone(a.worker.kind)} />
        <span className="min-w-0 truncate">
          <span className="font-medium">{parts.name}</span>
          {parts.detail ? <span className="text-muted-foreground"> {parts.detail}</span> : null}
        </span>
      </>
    );
  } else {
    content = <span className="min-w-0 truncate">{a.configuredId}</span>;
  }

  const trailing = over ? null : capability ? (
    <CircleAlert aria-hidden className="ml-auto size-4 shrink-0 text-danger" />
  ) : role ? (
    <ChevronDown aria-hidden className="ml-auto size-3.5 shrink-0 text-subtle-foreground" />
  ) : (
    <ArrowLeftRight aria-hidden className="ml-auto size-3.5 shrink-0 text-subtle-foreground" />
  );

  const dragProps = canDrag ? drag.startProps({ workerId: a.configuredId, from: { target } }) : {};
  const pickerKey = `slot:${target}`;

  return (
    <ModelPicker
      presentation="popover"
      items={items}
      value={a.configuredId}
      onValueChange={(id) => editor.assign(target, id)}
      filter={capabilityFilter(role)}
      title={pickerTitle(name)}
      hint={capabilityHint(role)}
      allowAuto
      autoSublabel={autoPick.worker ? workerLabel(autoPick.worker) : undefined}
      hiddenLabel={hiddenTextModels}
      revealedSelectable
      open={pickerFor === pickerKey}
      onOpenChange={(o) => setPickerFor(o ? pickerKey : null)}
      disabled={readOnly}
    >
      <button
        type="button"
        data-slot="model-slot"
        disabled={readOnly}
        aria-label={`Modell für ${name}: ${a.unavailable ? `${a.configuredId} nicht verfügbar` : a.label}. Ändern`}
        aria-describedby={capability && errorId ? errorId : undefined}
        {...dragProps}
        onClick={(e) => {
          // A drag that ended on this slot must not also open the picker.
          if (drag.consumeClick()) e.preventDefault();
        }}
        className={cn(
          "relative z-10 flex h-9 w-full min-w-0 select-none items-center gap-2 rounded-md border bg-background px-2.5 text-left text-ui text-foreground",
          "transition-colors duration-150 hover:border-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          "disabled:cursor-not-allowed disabled:opacity-60",
          canDrag && "md:cursor-grab",
          tone,
          (isSource || (incompatible && !over)) && "opacity-50",
        )}
      >
        {content}
        {trailing}
      </button>
    </ModelPicker>
  );
}
