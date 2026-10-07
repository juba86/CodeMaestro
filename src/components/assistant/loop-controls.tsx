"use client";

import { Repeat } from "lucide-react";
import { DEFAULT_LOOP_OPTIONS, type LoopOptions } from "./types";

const INTERVALS: { sec: number; label: string }[] = [
  { sec: 0, label: "aus" },
  { sec: 60, label: "1 min" },
  { sec: 300, label: "5 min" },
  { sec: 600, label: "10 min" },
  { sec: 1800, label: "30 min" },
  { sec: 3600, label: "1 h" },
];

/** Normalizes the options to what assistantLoopSchema accepts. */
export function loopBody(o: LoopOptions): LoopOptions {
  const n = Math.floor(o.maxIterations);
  return {
    ...o,
    maxIterations: Number.isFinite(n) && n >= 1 ? Math.min(100, n) : DEFAULT_LOOP_OPTIONS.maxIterations,
    completionPromise: o.completionPromise.trim().slice(0, 100) || DEFAULT_LOOP_OPTIONS.completionPromise,
  };
}

const field = "w-full rounded-md border border-input bg-background px-2 py-1 text-xs";

export function LoopControls({ value, onChange }: { value: LoopOptions; onChange: (v: LoopOptions) => void }) {
  const signal = value.completionPromise.trim() || DEFAULT_LOOP_OPTIONS.completionPromise;
  return (
    <div className="mx-3 mt-2 rounded-md border border-border p-3 space-y-2 text-xs">
      <div className="font-medium flex items-center gap-1.5 text-sm"><Repeat size={14} /> Loop-Modus</div>
      <p className="text-[11px] text-muted-foreground">
        Die Aufgabe wird auf dem Server wiederholt, bis der Agent fertig ist, das Limit erreicht ist oder du stoppst —
        auch wenn dieses Fenster geschlossen ist.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <label className="space-y-1 min-w-0">
          <span className="block text-muted-foreground">Max. Iterationen</span>
          <input
            type="number"
            min={1}
            max={100}
            inputMode="numeric"
            className={field}
            value={value.maxIterations || ""}
            onChange={(e) => onChange({ ...value, maxIterations: Number(e.target.value) })}
          />
        </label>
        <label className="space-y-1 min-w-0">
          <span className="block text-muted-foreground">Abschluss-Signal</span>
          <input
            className={`${field} font-mono`}
            maxLength={100}
            placeholder="DONE"
            value={value.completionPromise}
            onChange={(e) => onChange({ ...value, completionPromise: e.target.value })}
          />
        </label>
        <label className="space-y-1 min-w-0">
          <span className="block text-muted-foreground">Intervall</span>
          <select
            className={field}
            value={value.intervalSec}
            onChange={(e) => onChange({ ...value, intervalSec: Number(e.target.value) })}
          >
            {INTERVALS.map((i) => <option key={i.sec} value={i.sec}>{i.label}</option>)}
          </select>
        </label>
        <label className="space-y-1 min-w-0">
          <span className="block text-muted-foreground">Kontext</span>
          <select
            className={field}
            value={value.freshContext ? "fresh" : "continue"}
            onChange={(e) => onChange({ ...value, freshContext: e.target.value === "fresh" })}
          >
            <option value="continue">fortsetzen</option>
            <option value="fresh">frisch je Iteration</option>
          </select>
        </label>
      </div>
      <label className="flex items-center gap-1.5 cursor-pointer w-fit">
        <input
          type="checkbox"
          checked={value.stopOnError}
          onChange={(e) => onChange({ ...value, stopOnError: e.target.checked })}
        />
        Bei Fehler stoppen
      </label>
      <p className="text-[11px] text-muted-foreground break-words">
        Der Agent gibt <code className="px-1 rounded bg-accent">&lt;promise&gt;{signal}&lt;/promise&gt;</code> aus, wenn er fertig ist.
        {value.freshContext
          ? " Frischer Kontext: jede Iteration startet neu — der Fortschritt lebt in den Dateien des Projekts."
          : " Fortsetzen: alle Iterationen laufen in derselben Unterhaltung."}
        {value.intervalSec > 0 && " Mit Intervall pausiert der Loop zwischen den Iterationen."}
      </p>
    </div>
  );
}
