"use client";

import Link from "next/link";
import { ChevronRight, Circle, CircleCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { Progress } from "@/components/ui/progress";

export interface SetupStep {
  key: string;
  label: string;
  hint: string;
  href: string;
  done: boolean;
  optional?: boolean;
}

/** First run (no session, no provider): the „Einrichten" checklist (DESIGN.md §6.1). */
export function SetupChecklist({ steps, className }: { steps: SetupStep[]; className?: string }) {
  const required = steps.filter((s) => !s.optional);
  const done = required.filter((s) => s.done).length;
  return (
    <Card asChild className={className}>
      <section aria-labelledby="home-setup">
        <div className="flex flex-col gap-2 border-b border-border px-4 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="home-setup" className="text-base font-semibold text-foreground">
              Einrichten
            </h2>
            <span className="text-xs tabular-nums text-muted-foreground">
              {done} von {required.length} erledigt
            </span>
          </div>
          <p className="text-sm text-muted-foreground md:text-ui">
            Ein paar Schritte, dann steuerst du deine Agenten von überall – auch vom Handy.
          </p>
          <Progress value={done} max={required.length} label="Einrichtung" valueText={`${done} von ${required.length} erledigt`} tone="success" />
        </div>
        <ol className="divide-y divide-border">
          {steps.map((s) => (
            <li key={s.key}>
              <Link
                href={s.href}
                className="flex min-h-14 items-center gap-3 px-4 py-2.5 hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              >
                {s.done ? (
                  <CircleCheck aria-hidden className="size-5 shrink-0 text-success" />
                ) : (
                  <Circle aria-hidden className="size-5 shrink-0 text-subtle-foreground" />
                )}
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-sm font-medium md:text-ui", s.done ? "text-muted-foreground" : "text-foreground")}>
                    {s.label}
                    {s.optional ? <span className="font-normal text-subtle-foreground"> (optional)</span> : null}
                    <span className="sr-only">{s.done ? " – erledigt" : " – offen"}</span>
                  </span>
                  <span className="block text-xs text-muted-foreground">{s.hint}</span>
                </span>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-subtle-foreground" />
              </Link>
            </li>
          ))}
        </ol>
      </section>
    </Card>
  );
}
