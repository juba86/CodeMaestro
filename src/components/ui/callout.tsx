"use client";

import type * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { CircleCheck, CircleX, Info, TriangleAlert, X } from "lucide-react";
import { cn } from "./cn";
import { IconButton } from "./button";

const calloutVariants = cva("flex gap-3 rounded-lg border p-3 text-ui", {
  variants: {
    variant: {
      info: "border-info-border bg-info-subtle [&_[data-slot=callout-icon]]:text-info",
      success: "border-success-border bg-success-subtle [&_[data-slot=callout-icon]]:text-success",
      warning: "border-warning-border bg-warning-subtle [&_[data-slot=callout-icon]]:text-warning",
      danger: "border-danger-border bg-danger-subtle [&_[data-slot=callout-icon]]:text-danger",
    },
  },
  defaultVariants: { variant: "info" },
});

const ICONS = { info: Info, success: CircleCheck, warning: TriangleAlert, danger: CircleX } as const;

export type CalloutProps = Omit<React.ComponentProps<"div">, "title"> &
  VariantProps<typeof calloutVariants> & {
    title?: React.ReactNode;
    /** Replaces the default icon; `null` hides it. */
    icon?: React.ReactNode;
    /** Buttons or links shown under the text. */
    action?: React.ReactNode;
    /**
     * Warning/danger only: announce with role="alert". Use it only when the
     * callout appears in response to an action (not on page load).
     */
    announce?: boolean;
    onDismiss?: () => void;
    dismissLabel?: string;
  };

export function Callout({
  className,
  variant,
  title,
  icon,
  action,
  announce = false,
  onDismiss,
  dismissLabel = "Hinweis schließen",
  children,
  ...props
}: CalloutProps) {
  const v = variant ?? "info";
  const Icon = ICONS[v];
  const role = v === "info" || v === "success" ? "status" : announce ? "alert" : undefined;
  return (
    <div data-slot="callout" role={role} className={cn(calloutVariants({ variant: v }), className)} {...props}>
      {icon === null ? null : (
        <span data-slot="callout-icon" aria-hidden className="mt-0.5 shrink-0 [&_svg]:size-4">
          {icon ?? <Icon />}
        </span>
      )}
      <div className="min-w-0 flex-1 space-y-1">
        {title ? <p className="font-semibold text-foreground">{title}</p> : null}
        {children ? <div className="text-foreground [&_a]:text-primary-text [&_a]:underline-offset-4 hover:[&_a]:underline">{children}</div> : null}
        {action ? <div className="flex flex-wrap items-center gap-2 pt-1.5">{action}</div> : null}
      </div>
      {onDismiss ? (
        <IconButton aria-label={dismissLabel} size="icon-sm" className="-mr-1 -mt-1" onClick={onDismiss}>
          <X />
        </IconButton>
      ) : null}
    </div>
  );
}
