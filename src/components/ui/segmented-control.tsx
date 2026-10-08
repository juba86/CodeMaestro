"use client";

import * as React from "react";
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import { cn } from "./cn";

type Size = "sm" | "md";
const SizeContext = React.createContext<{ size: Size; stretch: boolean }>({ size: "md", stretch: false });

export type SegmentedControlProps = Omit<
  React.ComponentProps<typeof ToggleGroupPrimitive.Root>,
  "type" | "value" | "defaultValue" | "onValueChange"
> & {
  value: string;
  onValueChange: (value: string) => void;
  size?: Size;
  /** Items share the full width. */
  stretch?: boolean;
};

/**
 * Single-choice segmented control (radix ToggleGroup, radio semantics). It can
 * never be emptied: clicking the active item keeps it selected.
 */
export function SegmentedControl({
  value,
  onValueChange,
  size = "md",
  stretch = false,
  className,
  children,
  ...props
}: SegmentedControlProps) {
  return (
    <SizeContext.Provider value={{ size, stretch }}>
      <ToggleGroupPrimitive.Root
        data-slot="segmented-control"
        type="single"
        value={value}
        onValueChange={(v) => {
          if (v) onValueChange(v);
        }}
        className={cn(
          "inline-flex items-center gap-0.5 rounded-md border border-border bg-surface-2 p-0.5",
          size === "md" ? "h-10 md:h-8" : "h-9 md:h-7",
          stretch && "flex w-full",
          className,
        )}
        {...props}
      >
        {children}
      </ToggleGroupPrimitive.Root>
    </SizeContext.Provider>
  );
}

export type SegmentedItemProps = React.ComponentProps<typeof ToggleGroupPrimitive.Item> & {
  /** Decorative leading icon. */
  icon?: React.ReactNode;
  /** Trailing dot marking a modified value (e.g. "Ausgewogen ●"). */
  modified?: boolean;
  modifiedLabel?: string;
};

export function SegmentedItem({
  className,
  icon,
  modified,
  modifiedLabel = "geändert",
  children,
  ...props
}: SegmentedItemProps) {
  const { size, stretch } = React.useContext(SizeContext);
  return (
    <ToggleGroupPrimitive.Item
      data-slot="segmented-item"
      className={cn(
        "inline-flex h-full items-center justify-center gap-1.5 whitespace-nowrap rounded-[5px] font-medium text-muted-foreground transition-colors duration-150",
        "hover:text-foreground data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-sm",
        "disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
        size === "md" ? "px-3 text-ui md:px-2.5" : "px-2.5 text-xs md:px-2",
        stretch && "flex-1",
        className,
      )}
      {...props}
    >
      {icon ? <span aria-hidden className="contents">{icon}</span> : null}
      {children}
      {modified ? (
        <>
          <span aria-hidden className="size-1.5 rounded-full bg-primary-text" />
          <span className="sr-only">({modifiedLabel})</span>
        </>
      ) : null}
    </ToggleGroupPrimitive.Item>
  );
}
