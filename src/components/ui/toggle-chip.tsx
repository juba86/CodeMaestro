"use client";

import type * as React from "react";
import { Toggle as TogglePrimitive } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./cn";

export const toggleChipVariants = cva(
  "inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md border font-medium transition-colors duration-150 " +
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 " +
    "[&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 " +
    "data-[state=on]:border-primary-border data-[state=on]:bg-primary-subtle data-[state=on]:text-primary-text",
  {
    variants: {
      variant: {
        default: "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
        // Brand-tinted even when off (mode chips); stronger when on.
        brand: "border-primary-border text-primary-text hover:bg-primary-subtle",
      },
      size: {
        sm: "h-9 px-2.5 text-xs md:h-7 md:px-2",
        md: "h-10 px-3 text-sm md:h-8 md:px-2.5 md:text-ui",
      },
    },
    defaultVariants: { variant: "default", size: "sm" },
  },
);

/** Toggle chip with aria-pressed (tools, Wissen, filters). */
export function ToggleChip({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> & VariantProps<typeof toggleChipVariants>) {
  return <TogglePrimitive.Root data-slot="toggle-chip" className={cn(toggleChipVariants({ variant, size }), className)} {...props} />;
}
