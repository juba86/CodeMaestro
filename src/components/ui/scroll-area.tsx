"use client";

import type * as React from "react";
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui";
import { cn } from "./cn";

export function ScrollArea({
  className,
  viewportClassName,
  viewportRef,
  viewportProps,
  children,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  viewportClassName?: string;
  viewportRef?: React.Ref<HTMLDivElement>;
  /** Extra props for the scrolling element (e.g. tabIndex, aria-label, onScroll). */
  viewportProps?: React.ComponentProps<typeof ScrollAreaPrimitive.Viewport>;
}) {
  return (
    <ScrollAreaPrimitive.Root data-slot="scroll-area" className={cn("relative overflow-hidden", className)} {...props}>
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        className={cn(
          "size-full rounded-[inherit] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
          viewportClassName,
        )}
        {...viewportProps}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollBar orientation="horizontal" />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

export function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Scrollbar>) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-bar"
      orientation={orientation}
      className={cn(
        "flex touch-none select-none p-px transition-colors",
        orientation === "vertical" && "h-full w-2 border-l border-l-transparent",
        orientation === "horizontal" && "h-2 flex-col border-t border-t-transparent",
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-border-strong" />
    </ScrollAreaPrimitive.Scrollbar>
  );
}
