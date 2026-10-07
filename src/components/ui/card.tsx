import type * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./cn";

export const cardVariants = cva("rounded-lg border bg-card text-card-foreground", {
  variants: {
    variant: {
      default: "border-border shadow-xs",
      interactive:
        "block border-border text-left shadow-xs transition-colors duration-150 hover:border-border-strong hover:bg-accent/60 " +
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
      inset: "border-border bg-surface-2",
      warning: "border-warning-border shadow-sm",
      danger: "border-danger-border shadow-xs",
      selected: "border-transparent shadow-xs ring-2 ring-ring",
      live: "relative overflow-hidden border-primary-border bg-linear-to-b from-primary-subtle to-primary-subtle shadow-xs",
    },
  },
  defaultVariants: { variant: "default" },
});

export type CardProps = React.ComponentProps<"div"> &
  VariantProps<typeof cardVariants> & {
    /** Render the child element (a link or button) as the card. */
    asChild?: boolean;
    /** `live` only: show the working sweep bar along the bottom edge (default true). */
    sweep?: boolean;
  };

export function Card({ className, variant, asChild, sweep = true, children, ...props }: CardProps) {
  const cls = cn(cardVariants({ variant }), className);
  const bar = variant === "live" && sweep ? <SweepBar /> : null;
  if (asChild) {
    return (
      <Slot.Root data-slot="card" className={cls} {...props}>
        <Slot.Slottable>{children}</Slot.Slottable>
        {bar}
      </Slot.Root>
    );
  }
  return (
    <div data-slot="card" className={cls} {...props}>
      {children}
      {bar}
    </div>
  );
}

/**
 * The 2px "working" sweep along the bottom edge of a live card or run bar.
 * Decorative: the state is always also in text. Static under reduced motion.
 */
export function SweepBar({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-primary/15", className)}
    >
      <span className="block h-full w-2/5 bg-primary motion-safe:animate-sweep" />
    </span>
  );
}

export function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-header" className={cn("flex flex-col gap-1 p-4 pb-2", className)} {...props} />;
}

export function CardTitle({
  className,
  asChild,
  ...props
}: React.ComponentProps<"h3"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "h3";
  return <Comp data-slot="card-title" className={cn("text-ui font-semibold text-foreground", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="card-description" className={cn("text-xs text-muted-foreground md:text-ui", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("p-4 pt-2", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex flex-wrap items-center gap-2 border-t border-border px-4 py-3", className)}
      {...props}
    />
  );
}
