"use client";

import { useMemo } from "react";
import { diffLines, diffStats } from "@/lib/diff";

export function VersionDiff({ from, to, fromLabel, toLabel }: {
  from: string;
  to: string;
  fromLabel: string;
  toLabel: string;
}) {
  const lines = useMemo(() => diffLines(from, to), [from, to]);
  const stats = useMemo(() => diffStats(lines), [lines]);

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {fromLabel} → {toLabel} ·{" "}
        <span className="text-green-500">+{stats.added}</span>{" "}
        <span className="text-red-500">−{stats.removed}</span>
      </p>
      <pre className="p-4 rounded-lg border border-border bg-accent/30 text-xs font-mono overflow-x-auto max-h-[500px] overflow-y-auto leading-relaxed">
        {lines.map((l, idx) => (
          <div
            key={idx}
            className={
              l.op === "add"
                ? "bg-green-500/15 text-green-300"
                : l.op === "del"
                  ? "bg-red-500/15 text-red-300"
                  : ""
            }
          >
            <span className="select-none text-muted-foreground">
              {l.op === "add" ? "+ " : l.op === "del" ? "- " : "  "}
            </span>
            {l.text || " "}
          </div>
        ))}
      </pre>
    </div>
  );
}
