"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useBuilderStore } from "@/stores/builder-store";
import { cn } from "@/components/ui/cn";
import { TechniqueRecommender } from "./technique-recommender";
import { PromptQualityPanel, type QualityState } from "./prompt-quality-panel";
import { SwarmConfigPanel } from "./swarm-config-panel";
import type { LintField } from "./lint-labels";

/**
 * The builder's right rail (DESIGN.md §6.5): Technik-Empfehlung, Qualität and
 * the collapsed „Erweitert" section with the swarm settings. Rendered as a
 * 320px column on wide screens and inside the „Technik & Qualität" sheet below.
 */
export function BuilderRail({
  quality,
  onFocusField,
  className,
}: {
  quality: QualityState;
  onFocusField: (field: LintField) => void;
  className?: string;
}) {
  const swarmOn = useBuilderStore((s) => !!s.structured.swarmConfig);
  // Follows "is a swarm configured" until the user toggles it.
  const [advancedOpen, setAdvancedOpen] = useState<boolean | null>(null);
  const open = advancedOpen ?? swarmOn;

  return (
    <div className={cn("space-y-4", className)}>
      <TechniqueRecommender onExampleGoal={() => onFocusField("instructions")} />
      <PromptQualityPanel quality={quality} onFocusField={onFocusField} />
      <section className="rounded-lg border border-border bg-card shadow-xs">
        <h2>
          <button
            type="button"
            aria-expanded={open}
            aria-controls="pb-advanced"
            onClick={() => setAdvancedOpen(!open)}
            className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-4 py-3 text-left text-ui font-semibold hover:bg-accent/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring md:min-h-10"
          >
            <span>
              Erweitert
              {swarmOn && !open ? <span className="ml-2 font-normal text-muted-foreground">Schwarm aktiv</span> : null}
            </span>
            <ChevronDown aria-hidden className={cn("size-4 text-subtle-foreground transition-transform", open && "rotate-180")} />
          </button>
        </h2>
        {open ? (
          <div id="pb-advanced" className="border-t border-border px-4 pb-4 pt-1">
            <SwarmConfigPanel />
          </div>
        ) : null}
      </section>
    </div>
  );
}
