"use client";

import { useMemo } from "react";
import { diffLines } from "@/lib/diff";
import { DiffView } from "@/components/ui/diff-view";

/** Line diff between two prompt versions (same row model as approval diffs). */
export function VersionDiff({ from, to, fromLabel, toLabel }: {
  from: string;
  to: string;
  fromLabel: string;
  toLabel: string;
}) {
  const parts = useMemo(() => diffLines(from, to), [from, to]);
  return (
    <DiffView
      parts={parts}
      aria-label={`Änderungen von ${fromLabel} zu ${toLabel}`}
      title={
        <span className="font-mono text-muted-foreground">
          {fromLabel} → {toLabel}
        </span>
      }
    />
  );
}
