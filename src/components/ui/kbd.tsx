import type * as React from "react";
import { cn } from "./cn";

const KBD_VARIANTS = {
  default: "border-border-strong bg-surface-2 text-muted-foreground",
  // On a solid primary fill (e.g. a primary Button): a darkened chip keeps the
  // white text ≥ 6.7:1 in both themes (a white/10 tint dropped it to ~4:1 in dark).
  "on-primary": "border-primary-foreground/30 bg-black/20 text-primary-foreground",
} as const;

export type KbdProps = React.ComponentProps<"kbd"> & {
  variant?: keyof typeof KBD_VARIANTS;
};

export function Kbd({ className, variant = "default", ...props }: KbdProps) {
  return (
    <kbd
      data-variant={variant}
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-sm border px-1 font-mono text-xs leading-none",
        KBD_VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}
