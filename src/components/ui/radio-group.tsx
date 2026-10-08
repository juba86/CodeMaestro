"use client";

import * as React from "react";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { cn } from "./cn";

export function RadioGroup({ className, ...props }: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return <RadioGroupPrimitive.Root data-slot="radio-group" className={cn("grid gap-2", className)} {...props} />;
}

/** The visual radio circle, shared by RadioGroupItem and RadioCard. */
function RadioDot({ tone = "default" }: { tone?: "default" | "danger" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-5 shrink-0 place-items-center rounded-full border border-input bg-background",
        tone === "danger"
          ? "group-data-[state=checked]:border-danger group-data-[state=checked]:border-2"
          : "group-data-[state=checked]:border-primary group-data-[state=checked]:border-2",
      )}
    >
      <span
        className={cn(
          "size-2.5 scale-0 rounded-full transition-transform duration-150 group-data-[state=checked]:scale-100",
          tone === "danger" ? "bg-danger" : "bg-primary",
        )}
      />
    </span>
  );
}

/** A plain radio (20px) with a 24px hit area. Label it with a <label htmlFor>. */
export function RadioGroupItem({ className, ...props }: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        "group relative shrink-0 rounded-full after:absolute after:-inset-0.5 after:content-[''] disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className,
      )}
      {...props}
    >
      <RadioDot />
    </RadioGroupPrimitive.Item>
  );
}

export type RadioCardProps = Omit<React.ComponentProps<typeof RadioGroupPrimitive.Item>, "title" | "children"> & {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Shown next to the title, e.g. <Badge variant="brand">empfohlen</Badge>. */
  badge?: React.ReactNode;
  /** `danger` for unsafe options (e.g. "Volle Autonomie"). */
  tone?: "default" | "danger";
  /** Why this option is unavailable; disables the card and shows the reason. */
  disabledReason?: string;
  /**
   * Extra content inside the card (below the description). The card is a
   * <button>: pass only non-interactive content here and put follow-up
   * controls (e.g. a confirmation checkbox) after the card.
   */
  children?: React.ReactNode;
};

/** The whole card is the radio item: title, description, optional badge. */
export function RadioCard({
  className,
  title,
  description,
  badge,
  tone = "default",
  disabledReason,
  disabled,
  children,
  ...props
}: RadioCardProps) {
  const id = React.useId();
  const titleId = `${id}-title`;
  const descId = `${id}-desc`;
  const reasonId = `${id}-reason`;
  const describedBy = [description ? descId : null, disabledReason ? reasonId : null].filter(Boolean).join(" ") || undefined;
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-card"
      aria-labelledby={titleId}
      aria-describedby={describedBy}
      disabled={disabled || Boolean(disabledReason)}
      className={cn(
        "group flex w-full items-start gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors duration-150",
        "hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        "disabled:cursor-not-allowed disabled:hover:border-border",
        tone === "danger"
          ? "data-[state=checked]:border-danger-border data-[state=checked]:bg-danger-subtle"
          : "data-[state=checked]:border-primary-border data-[state=checked]:bg-primary-subtle",
        className,
      )}
      {...props}
    >
      <span className="pt-px group-disabled:opacity-50">
        <RadioDot tone={tone} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2 group-disabled:opacity-60">
          <span id={titleId} className={cn("text-sm font-medium md:text-ui", tone === "danger" && "group-data-[state=checked]:text-danger")}>
            {title}
          </span>
          {badge}
        </span>
        {description ? (
          <span id={descId} className="text-ui text-muted-foreground group-disabled:opacity-60">
            {description}
          </span>
        ) : null}
        {disabledReason ? (
          <span id={reasonId} className="text-ui text-subtle-foreground">
            {disabledReason}
          </span>
        ) : null}
        {children}
      </span>
    </RadioGroupPrimitive.Item>
  );
}
