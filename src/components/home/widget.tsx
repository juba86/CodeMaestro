"use client";

import { useId, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { cn } from "@/components/ui/cn";
import { Skeleton } from "@/components/ui/skeleton";

/** A dashboard block: h2 title (with an optional count/action) and its content. */
export function Widget({
  title,
  meta,
  action,
  children,
  className,
}: {
  title: ReactNode;
  /** Next to the title, e.g. a count badge. */
  meta?: ReactNode;
  /** Right side, e.g. a „Alle" link. */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn("min-w-0", className)}>
      <div className="mb-2 flex min-h-7 items-center gap-2">
        <h2 id={id} className="text-sm font-semibold text-foreground md:text-ui">
          {title}
        </h2>
        {meta}
        {action ? <div className="ml-auto flex items-center gap-1">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** A widget that failed to load: short reason + [Erneut versuchen]. */
export function WidgetError({ title, message, onRetry, loading }: { title: string; message?: string | null; onRetry: () => void; loading?: boolean }) {
  return (
    <Callout
      variant="warning"
      title={title}
      action={
        <Button variant="outline" loading={loading} onClick={onRetry}>
          Erneut versuchen
        </Button>
      }
    >
      {message || null}
    </Callout>
  );
}

/** Skeleton rows with a status text for screen readers. */
export function RowsSkeleton({ rows = 3, label, className }: { rows?: number; label: string; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1 rounded-lg border border-border bg-card p-2 shadow-xs", className)} aria-busy>
      <span className="sr-only" role="status">
        {label}
      </span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-2 py-2">
          <Skeleton className="size-4 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5" style={{ width: `${70 - i * 12}%` }} />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
