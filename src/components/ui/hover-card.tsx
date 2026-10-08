"use client";

import type * as React from "react";
import { HoverCard as HoverCardPrimitive } from "radix-ui";
import { cn } from "./cn";
import { floatingAnimation } from "./popover";

export function HoverCard({ openDelay = 400, closeDelay = 150, ...props }: React.ComponentProps<typeof HoverCardPrimitive.Root>) {
  return <HoverCardPrimitive.Root openDelay={openDelay} closeDelay={closeDelay} {...props} />;
}

export const HoverCardTrigger = HoverCardPrimitive.Trigger;

/** Hover-only extra detail: never the only place information lives. */
export function HoverCardContent({
  className,
  align = "center",
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Content>) {
  return (
    <HoverCardPrimitive.Portal>
      <HoverCardPrimitive.Content
        data-slot="hover-card-content"
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          "z-50 w-64 origin-(--radix-hover-card-content-transform-origin) rounded-xl border border-border-strong bg-popover p-3 text-ui text-foreground shadow-md outline-none",
          floatingAnimation,
          className,
        )}
        {...props}
      />
    </HoverCardPrimitive.Portal>
  );
}
