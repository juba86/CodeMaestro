import type * as React from "react";
import { cn } from "./cn";

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  children,
  className,
  headingLevel = 2,
}: {
  /** Decorative icon element, e.g. `<SquareTerminal />`. */
  icon?: React.ReactNode;
  title: React.ReactNode;
  /** One sentence. */
  description?: React.ReactNode;
  action?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  headingLevel?: 2 | 3 | 4;
}) {
  const Heading = `h${headingLevel}` as "h2" | "h3" | "h4";
  return (
    <div data-slot="empty-state" className={cn("mx-auto flex max-w-sm flex-col items-center px-4 py-10 text-center", className)}>
      {icon ? (
        <span aria-hidden className="mb-3 grid size-10 place-items-center rounded-lg border border-border bg-surface-2 text-subtle-foreground [&_svg]:size-5">
          {icon}
        </span>
      ) : null}
      <Heading className="text-sm font-semibold text-foreground">{title}</Heading>
      {description ? <p className="mt-1 text-ui text-muted-foreground">{description}</p> : null}
      {action || secondaryAction ? (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      ) : null}
      {children}
    </div>
  );
}
