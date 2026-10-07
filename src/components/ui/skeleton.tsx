import type * as React from "react";
import { cn } from "./cn";

/** Loading placeholder. Decorative: pair it with a status text for screen readers. */
export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn("rounded-md bg-muted motion-safe:animate-pulse", className)}
      {...props}
    />
  );
}
