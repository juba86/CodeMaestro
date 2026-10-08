"use client";

import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";

export type BuilderStep = "form" | "edit" | "preview" | "refine";

export interface StepView {
  id: BuilderStep;
  label: string;
  /** The open step (aria-current="step"); it can be invalid at the same time. */
  current: boolean;
  status: "complete" | "current" | "invalid" | "upcoming";
  /** Why the step is invalid (danger dot + text). */
  reason?: string;
  /** Why the step can't be opened yet (disabled with tooltip). */
  lockedReason?: string;
}

// The current step is announced through aria-current.
const STATUS_SR: Record<StepView["status"], string> = {
  complete: "abgeschlossen",
  current: "",
  invalid: "unvollständig",
  upcoming: "",
};

/** 1 Projekt · 2 Abschnitte · 3 Vorschau · 4 Verfeinern, with real states (DESIGN.md §6.5). */
export function BuilderStepper({ steps, onSelect }: { steps: StepView[]; onSelect: (id: BuilderStep) => void }) {
  return (
    <nav aria-label="Schritte">
      <ol className="flex items-stretch gap-1 md:items-center md:gap-0">
        {steps.map((s, i) => {
          const current = s.current;
          // The open step keeps its fill when it is invalid as well; the dot marks the problem.
          const look = current ? "current" : s.status;
          return (
            <li key={s.id} className="flex min-w-0 flex-1 items-center md:flex-none">
              <Button
                variant="ghost"
                aria-current={current ? "step" : undefined}
                disabledReason={s.lockedReason}
                onClick={() => onSelect(s.id)}
                className={cn(
                  "h-auto w-full min-w-0 flex-col gap-1 whitespace-normal px-1 py-1.5 md:w-auto md:flex-row md:gap-2 md:px-2",
                  current ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "relative grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold tabular-nums md:size-6",
                    look === "current" && "border-primary bg-primary text-primary-foreground",
                    look === "complete" && "border-primary-border bg-primary-subtle text-primary-text",
                    look === "invalid" && "border-danger-border bg-card text-danger",
                    look === "upcoming" && "border-border-strong bg-card text-muted-foreground",
                  )}
                >
                  {look === "complete" ? <Check className="size-3.5" /> : i + 1}
                  {s.status === "invalid" ? (
                    <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-background bg-danger" />
                  ) : null}
                </span>
                <span className="flex min-w-0 flex-col items-center md:items-start">
                  <span className={cn("truncate text-xs font-medium md:text-ui", current && "text-foreground")}>
                    <span className="sr-only">Schritt {i + 1}: </span>
                    {s.label}
                    {STATUS_SR[s.status] && s.status !== "current" ? (
                      <span className="sr-only"> ({STATUS_SR[s.status]})</span>
                    ) : null}
                  </span>
                  {s.status === "invalid" && s.reason ? (
                    <span className="sr-only text-xs font-normal text-danger md:not-sr-only md:block">{s.reason}</span>
                  ) : null}
                </span>
              </Button>
              {i < steps.length - 1 ? (
                <span aria-hidden className="mx-1 hidden h-px w-6 shrink-0 bg-border-strong md:block lg:w-10" />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
