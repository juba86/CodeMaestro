import type * as React from "react";
import { cn } from "./cn";

export type PageHeaderProps = Omit<React.ComponentProps<"header">, "title"> & {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Buttons on the right (wrap below the title on mobile). */
  actions?: React.ReactNode;
  /** Inline next to the title, e.g. a status Badge. */
  meta?: React.ReactNode;
};

/**
 * The page's single h1. Below md the h1 is sr-only because the shell AppBar
 * shows the title; description, meta and actions stay visible.
 */
export function PageHeader({ title, description, actions, meta, className, ...props }: PageHeaderProps) {
  return (
    <header
      data-slot="page-header"
      className={cn("flex flex-col gap-3 pb-4 md:flex-row md:items-start md:justify-between md:gap-6", className)}
      {...props}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
          <h1 className="sr-only md:not-sr-only md:text-xl md:font-semibold md:tracking-[-0.01em]">{title}</h1>
          {meta}
        </div>
        {description ? <p className="max-w-[70ch] text-ui text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
