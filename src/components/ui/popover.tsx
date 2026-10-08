"use client";

import type * as React from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { cn } from "./cn";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

export const floatingAnimation =
  "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-[180ms] ease-enter " +
  "motion-safe:data-[state=open]:zoom-in-95 motion-safe:data-[state=closed]:zoom-out-95 " +
  "motion-safe:data-[side=bottom]:slide-in-from-top-1 motion-safe:data-[side=top]:slide-in-from-bottom-1 " +
  "motion-safe:data-[side=left]:slide-in-from-right-1 motion-safe:data-[side=right]:slide-in-from-left-1";

export function PopoverContent({
  className,
  align = "start",
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          "z-50 w-72 max-w-[calc(100vw-1rem)] origin-(--radix-popover-content-transform-origin) rounded-xl border border-border-strong bg-popover p-3 text-foreground shadow-md outline-none",
          floatingAnimation,
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
