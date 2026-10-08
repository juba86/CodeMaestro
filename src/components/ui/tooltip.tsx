"use client";

import type * as React from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { cn } from "./cn";

/**
 * Tooltips open after 400ms on hover and immediately on keyboard focus. They
 * are never the only carrier of information. Each Tooltip brings its own
 * Provider, so there is no ordering requirement in the tree.
 */
export function Tooltip({
  delayDuration = 400,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration} skipDelayDuration={300}>
      <TooltipPrimitive.Root delayDuration={delayDuration} {...props} />
    </TooltipPrimitive.Provider>
  );
}

export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          "z-50 max-w-72 rounded-md border border-border-strong bg-popover px-2 py-1 text-xs text-foreground shadow-md",
          "data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=instant-open]:animate-in data-[state=instant-open]:fade-in-0",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-150 ease-enter",
          "motion-safe:data-[side=bottom]:slide-in-from-top-1 motion-safe:data-[side=top]:slide-in-from-bottom-1",
          "motion-safe:data-[side=left]:slide-in-from-right-1 motion-safe:data-[side=right]:slide-in-from-left-1",
          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

/** Convenience wrapper: `<SimpleTooltip content="…"><button/></SimpleTooltip>`. */
export function SimpleTooltip({
  content,
  children,
  side,
  align,
  open,
  onOpenChange,
  delayDuration,
  className,
}: {
  content: React.ReactNode;
  /** A single element that can hold a ref (it becomes the trigger). */
  children: React.ReactNode;
  side?: React.ComponentProps<typeof TooltipPrimitive.Content>["side"];
  align?: React.ComponentProps<typeof TooltipPrimitive.Content>["align"];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  delayDuration?: number;
  className?: string;
}) {
  if (content == null || content === false || content === "") return <>{children}</>;
  return (
    <Tooltip open={open} onOpenChange={onOpenChange} delayDuration={delayDuration}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} align={align} className={className}>
        {content}
      </TooltipContent>
    </Tooltip>
  );
}
