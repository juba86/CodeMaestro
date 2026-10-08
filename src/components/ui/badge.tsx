import type * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./cn";

// The *-subtle fills are translucent. Layering them over an opaque card base
// keeps the semantic text at its specified contrast on every surface (e.g. a
// warning badge on the surface-2 diff header would otherwise drop to 4.4:1).
const tint = {
  brand: "bg-card bg-linear-to-r from-primary-subtle to-primary-subtle",
  success: "bg-card bg-linear-to-r from-success-subtle to-success-subtle",
  warning: "bg-card bg-linear-to-r from-warning-subtle to-warning-subtle",
  danger: "bg-card bg-linear-to-r from-danger-subtle to-danger-subtle",
  info: "bg-card bg-linear-to-r from-info-subtle to-info-subtle",
};

export const badgeVariants = cva(
  "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border font-medium leading-none [&_svg]:size-3",
  {
    variants: {
      variant: {
        neutral: "border-border-strong bg-surface-2 text-muted-foreground",
        brand: `border-primary-border ${tint.brand} text-primary-text`,
        success: `border-success-border ${tint.success} text-success`,
        warning: `border-warning-border ${tint.warning} text-warning`,
        danger: `border-danger-border ${tint.danger} text-danger`,
        info: `border-info-border ${tint.info} text-info`,
        outline: "border-border-strong text-muted-foreground",
      },
      size: { sm: "h-5 px-2 text-xs", md: "h-6 px-2.5 text-xs" },
    },
    defaultVariants: { variant: "neutral", size: "sm" },
  },
);

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

export type BadgeProps = React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & {
    /** Leading icon (decorative). */
    icon?: React.ReactNode;
    /** Leading dot in the text colour (decorative; the label carries meaning). */
    dot?: boolean;
  };

export function Badge({ className, variant, size, icon, dot, children, ...props }: BadgeProps) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant, size }), className)} {...props}>
      {dot ? <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" /> : null}
      {icon}
      {children}
    </span>
  );
}
