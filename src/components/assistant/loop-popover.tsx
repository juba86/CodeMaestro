"use client";

import * as React from "react";
import { Minus, Plus } from "lucide-react";
import { IconButton } from "@/components/ui/button";
import { Field, FieldHint, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SegmentedControl, SegmentedItem } from "@/components/ui/segmented-control";
import { SimpleSelect } from "@/components/ui/select";
import { SwitchRow } from "@/components/ui/switch";
import { LOOP_INTERVALS, loopBody } from "./composer-logic";
import type { LoopOptions } from "./types";

/** Loop settings (DESIGN.md §6.2.5): max. iterations, signal, pause, context, stop on error. */
export function LoopSettings({ value, onChange }: { value: LoopOptions; onChange: (v: LoopOptions) => void }) {
  const signal = loopBody(value).completionPromise;
  const n = Number.isFinite(value.maxIterations) ? value.maxIterations : 0;
  const step = (d: number) => onChange({ ...value, maxIterations: Math.min(100, Math.max(1, Math.floor(n || 0) + d)) });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel>Max. Iterationen</FieldLabel>
          <div className="flex items-center gap-1">
            <IconButton aria-label="Eine Iteration weniger" variant="outline" size="icon" disabled={n <= 1} onClick={() => step(-1)}>
              <Minus />
            </IconButton>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={100}
              className="text-center tabular-nums"
              value={n || ""}
              onChange={(e) => onChange({ ...value, maxIterations: Number(e.target.value) })}
              onBlur={() => onChange({ ...value, maxIterations: loopBody(value).maxIterations })}
            />
            <IconButton aria-label="Eine Iteration mehr" variant="outline" size="icon" disabled={n >= 100} onClick={() => step(1)}>
              <Plus />
            </IconButton>
          </div>
        </Field>
        <Field>
          <FieldLabel>Abschlusssignal</FieldLabel>
          <Input
            className="font-mono"
            maxLength={100}
            placeholder="DONE"
            value={value.completionPromise}
            onChange={(e) => onChange({ ...value, completionPromise: e.target.value })}
          />
        </Field>
      </div>
      <Field>
        <FieldLabel>Pause zwischen Iterationen</FieldLabel>
        <SimpleSelect
          value={String(value.intervalSec)}
          onValueChange={(v) => onChange({ ...value, intervalSec: Number(v) })}
          options={LOOP_INTERVALS.map((i) => ({ value: String(i.sec), label: i.label }))}
        />
      </Field>
      <Field>
        <FieldLabel id="loop-context-label">Kontext</FieldLabel>
        <SegmentedControl
          aria-labelledby="loop-context-label"
          stretch
          value={value.freshContext ? "fresh" : "continue"}
          onValueChange={(v) => onChange({ ...value, freshContext: v === "fresh" })}
        >
          <SegmentedItem value="continue">Fortsetzen</SegmentedItem>
          <SegmentedItem value="fresh">Frisch je Iteration</SegmentedItem>
        </SegmentedControl>
        <FieldHint>
          {value.freshContext
            ? "Jede Iteration startet neu – der Fortschritt lebt in den Dateien des Projekts."
            : "Alle Iterationen laufen in derselben Unterhaltung."}
        </FieldHint>
      </Field>
      <SwitchRow label="Bei Fehler stoppen" checked={value.stopOnError} onCheckedChange={(v) => onChange({ ...value, stopOnError: v })} />
      <p className="text-ui text-muted-foreground">
        Der Prompt wird wiederholt gesendet, bis die Antwort ‚{signal}‘ enthält oder das Maximum erreicht ist. Der Loop läuft auf dem
        Server weiter, auch wenn dieses Fenster geschlossen ist.
      </p>
    </div>
  );
}
