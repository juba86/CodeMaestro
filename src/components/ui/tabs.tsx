"use client";

import * as React from "react";
import { Tabs as TabsPrimitive } from "radix-ui";
import { cn } from "./cn";

type Variant = "underline" | "pill";
const VariantContext = React.createContext<Variant>("underline");

export function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn("flex flex-col", className)} {...props} />;
}

export function TabsList({
  className,
  variant = "underline",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & { variant?: Variant }) {
  return (
    <VariantContext.Provider value={variant}>
      <TabsPrimitive.List
        data-slot="tabs-list"
        data-variant={variant}
        className={cn(
          variant === "underline"
            ? "flex h-11 shrink-0 items-stretch gap-4 overflow-x-auto border-b border-border scrollbar-none md:h-10"
            : "inline-flex h-10 w-fit max-w-full items-center gap-0.5 self-start overflow-x-auto rounded-md border border-border bg-surface-2 p-0.5 scrollbar-none md:h-8",
          className,
        )}
        {...props}
      />
    </VariantContext.Provider>
  );
}

export function TabsTrigger({
  className,
  count,
  countLabel,
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger> & {
  /** Optional count badge, e.g. the number of changed files. */
  count?: number;
  /** Accessible text for the count, e.g. "3 Dateien" (defaults to the number). */
  countLabel?: string;
}) {
  const variant = React.useContext(VariantContext);
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "group inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap font-medium text-muted-foreground transition-colors duration-150",
        "hover:text-foreground disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        variant === "underline"
          ? "relative px-0.5 text-sm md:text-ui data-[state=active]:text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full data-[state=active]:after:bg-primary"
          : "h-full rounded-[5px] px-3 text-ui md:px-2.5 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm",
        className,
      )}
      {...props}
    >
      {children}
      {count != null ? (
        <>
          <span
            aria-hidden={countLabel ? true : undefined}
            className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-border-strong px-1 text-xs tabular-nums text-muted-foreground group-data-[state=active]:text-foreground"
          >
            {count}
          </span>
          {countLabel ? <span className="sr-only">({countLabel})</span> : null}
        </>
      ) : null}
    </TabsPrimitive.Trigger>
  );
}

export function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("min-h-0 flex-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", className)}
      {...props}
    />
  );
}
