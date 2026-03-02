"use client";

import { useState, useEffect, useMemo } from "react";
import { useBuilderStore } from "@/stores/builder-store";
import { recommendTechniques, techniques, type TechniqueInfo } from "@/lib/prompt-engine/techniques";
import type { PromptTechnique } from "@/lib/ai/types";

const complexityColor: Record<string, string> = {
  low: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  high: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

export function TechniqueRecommender() {
  const { structured, updateStructured } = useBuilderStore();
  const [showAll, setShowAll] = useState(false);

  const taskText = `${structured.instructions} ${structured.task} ${structured.context}`.trim();

  const recommended = useMemo(() => {
    if (!taskText) return [];
    const hasExamples = structured.examples.length > 0;
    const isAgentic = !!structured.swarmConfig;
    return recommendTechniques(taskText, hasExamples, isAgentic, false);
  }, [taskText, structured.examples.length, structured.swarmConfig]);

  const displayTechniques = showAll ? techniques : recommended;
  const selectedTechnique = structured.technique;

  function handleSelect(id: PromptTechnique) {
    if (selectedTechnique === id) {
      updateStructured({ technique: undefined });
    } else {
      updateStructured({ technique: id });
    }
  }

  if (!taskText && !showAll) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Technique</h3>
          <button
            onClick={() => setShowAll(true)}
            className="text-xs text-primary hover:underline"
          >
            Browse all
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Enter your goal/task to get AI technique recommendations.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          {showAll ? "All Techniques" : "Recommended Techniques"}
        </h3>
        <button
          onClick={() => setShowAll(!showAll)}
          className="text-xs text-primary hover:underline"
        >
          {showAll ? "Show recommended" : "Browse all"}
        </button>
      </div>

      {!showAll && recommended.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Based on your task, we recommend these approaches:
        </p>
      )}

      <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
        {displayTechniques.map((t) => (
          <button
            key={t.id}
            onClick={() => handleSelect(t.id)}
            className={`w-full text-left p-3 rounded-lg border transition-colors ${
              selectedTechnique === t.id
                ? "border-primary bg-primary/5 ring-1 ring-primary"
                : "border-border hover:border-primary/40"
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium">{t.name}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${complexityColor[t.complexity]}`}>
                {t.complexity}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mb-1.5">{t.description}</p>
            <div className="flex items-center gap-1 flex-wrap">
              {t.bestFor.slice(0, 3).map((bf) => (
                <span
                  key={bf}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-accent text-muted-foreground"
                >
                  {bf}
                </span>
              ))}
              <span className="text-[10px] text-muted-foreground ml-auto">
                {t.accuracyGain}
              </span>
            </div>
          </button>
        ))}
      </div>

      {selectedTechnique && (
        <div className="text-xs text-muted-foreground pt-1 border-t border-border">
          Selected: <strong>{techniques.find((t) => t.id === selectedTechnique)?.name}</strong>
          {" — "}this technique will be incorporated into your generated prompt.
        </div>
      )}
    </div>
  );
}
