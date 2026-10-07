import type * as React from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "./cn";

type SpinnerProps = Omit<React.ComponentProps<typeof LoaderCircle>, "aria-label"> & {
  /** Accessible name. Omit only when visible text next to the spinner says what is happening. */
  "aria-label"?: string;
};

/** Spins only with motion allowed; otherwise a static icon. */
export function Spinner({ className, "aria-label": label, ...props }: SpinnerProps) {
  return (
    <LoaderCircle
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("size-4 shrink-0 motion-safe:animate-spin", className)}
      {...props}
    />
  );
}
