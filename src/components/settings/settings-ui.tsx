import type * as React from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";

/**
 * Section title (h2) + description. Below md the title is sr-only: the
 * section's own AppBar shows it there; the description and meta stay.
 */
export function SectionHeader({
  title,
  description,
  meta,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  /** Status badge next to the title. */
  meta?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-5 flex flex-col gap-1", className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
        <h2 className="max-md:sr-only text-lg font-semibold tracking-[-0.005em] text-foreground">{title}</h2>
        {meta}
      </div>
      {description ? <p className="max-w-[70ch] text-sm text-muted-foreground md:text-ui">{description}</p> : null}
    </div>
  );
}

/** A settings card: optional icon tile, h3 title, subtitle and a trailing badge, then the body. */
export function SettingsCard({
  title,
  description,
  icon,
  badge,
  footer,
  children,
  className,
  bodyClassName,
  ...props
}: Omit<React.ComponentProps<"section">, "title"> & {
  title?: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  footer?: React.ReactNode;
  bodyClassName?: string;
}) {
  return (
    <Card asChild className={cn("overflow-hidden", className)}>
      <section {...props}>
        {title ? (
          <div className="flex items-start gap-3 border-b border-border px-4 py-3">
            {icon ? (
              <span
                aria-hidden
                className="grid size-9 shrink-0 place-items-center rounded-full border border-border bg-surface-2 text-muted-foreground [&_svg]:size-4"
              >
                {icon}
              </span>
            ) : null}
            <div className="min-w-0 flex-1 self-center">
              <h3 className="text-sm font-semibold text-foreground md:text-ui">{title}</h3>
              {description ? <p className="text-xs text-muted-foreground md:text-ui">{description}</p> : null}
            </div>
            {badge ? <div className="shrink-0 self-center">{badge}</div> : null}
          </div>
        ) : null}
        <div className={cn("p-4", bodyClassName)}>{children}</div>
        {footer ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-border bg-surface/60 px-4 py-3">{footer}</div>
        ) : null}
      </section>
    </Card>
  );
}

/** Label/value rows (definition list) inside a card. */
export function InfoRows({ rows, className }: { rows: { label: React.ReactNode; value: React.ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("grid gap-x-4 gap-y-2 text-sm md:grid-cols-[9rem_minmax(0,1fr)] md:text-ui", className)}>
      {rows.map((r, i) => (
        <div key={i} className="contents">
          <dt className="text-muted-foreground">{r.label}</dt>
          <dd className="mb-1 min-w-0 break-words text-foreground md:mb-0">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Inline code in settings copy. */
export function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded-sm bg-surface-2 px-1 py-px font-mono text-[0.92em] text-foreground">{children}</code>;
}
