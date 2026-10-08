"use client";

import * as React from "react";
import { Select as SelectPrimitive } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "./cn";
import { useFieldControl } from "./field";

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

const triggerVariants = cva(
  "flex w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-left text-base text-foreground " +
    "md:text-ui data-[placeholder]:text-subtle-foreground disabled:cursor-not-allowed disabled:opacity-50 " +
    "aria-[invalid=true]:border-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring " +
    "[&>span]:min-w-0 [&>span]:truncate [&_svg]:shrink-0",
  { variants: { size: { sm: "h-9 md:h-7", md: "h-10 md:h-8", lg: "h-11 md:h-10" } }, defaultVariants: { size: "md" } },
);

export type SelectTriggerProps = React.ComponentProps<typeof SelectPrimitive.Trigger> & VariantProps<typeof triggerVariants>;

export function SelectTrigger({ className, size, children, ...props }: SelectTriggerProps) {
  const a11y = useFieldControl(props);
  return (
    <SelectPrimitive.Trigger data-slot="select-trigger" className={cn(triggerVariants({ size }), className)} {...a11y}>
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown aria-hidden className="size-4 text-subtle-foreground" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  position = "popper",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        position={position}
        sideOffset={position === "popper" ? sideOffset : undefined}
        className={cn(
          "relative z-50 max-h-(--radix-select-content-available-height) min-w-32 overflow-hidden rounded-xl border border-border-strong bg-popover text-foreground shadow-md",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-150 ease-enter",
          "motion-safe:data-[state=open]:zoom-in-95 motion-safe:data-[side=bottom]:slide-in-from-top-1 motion-safe:data-[side=top]:slide-in-from-bottom-1",
          position === "popper" && "w-full min-w-(--radix-select-trigger-width) max-w-[min(32rem,calc(100vw-1rem))]",
          className,
        )}
        {...props}
      >
        <SelectPrimitive.ScrollUpButton className="flex h-6 items-center justify-center text-subtle-foreground">
          <ChevronUp aria-hidden className="size-4" />
        </SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="flex h-6 items-center justify-center text-subtle-foreground">
          <ChevronDown aria-hidden className="size-4" />
        </SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectLabel({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn("px-2 pb-1 pt-2 text-xs font-medium text-subtle-foreground", className)}
      {...props}
    />
  );
}

export function SelectItem({
  className,
  children,
  description,
  badge,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item> & {
  /** Second line under the label (not shown in the trigger). */
  description?: React.ReactNode;
  /** Trailing slot, e.g. a Badge. */
  badge?: React.ReactNode;
}) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex min-h-10 w-full cursor-default select-none items-center gap-2 rounded-md py-1.5 pl-2 pr-8 text-sm outline-none md:min-h-8 md:text-ui",
        "data-[highlighted]:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
        {description ? <span className="text-xs text-muted-foreground">{description}</span> : null}
      </span>
      {badge ? <span className="shrink-0">{badge}</span> : null}
      <span className="absolute right-2 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check aria-hidden className="size-4 text-primary-text" />
        </SelectPrimitive.ItemIndicator>
      </span>
    </SelectPrimitive.Item>
  );
}

export function SelectSeparator({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return <SelectPrimitive.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />;
}

export interface SimpleSelectOption {
  value: string;
  label: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
}

// Radix Select reserves "" for "no value"; map empty option values through a sentinel.
const EMPTY = "__cm-empty__";
const toRadix = (v: string) => (v === "" ? EMPTY : v);
const fromRadix = (v: string) => (v === EMPTY ? "" : v);

export type SimpleSelectProps = {
  options: SimpleSelectOption[];
  value: string | undefined | null;
  onValueChange: (value: string) => void;
  placeholder?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: React.AriaAttributes["aria-invalid"];
  id?: string;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  contentClassName?: string;
};

/** One-line select for a flat option list. Replaces native <select>. */
export function SimpleSelect({
  options,
  value,
  onValueChange,
  placeholder,
  size,
  className,
  contentClassName,
  name,
  disabled,
  required,
  ...aria
}: SimpleSelectProps) {
  const known = value != null && options.some((o) => o.value === value);
  return (
    <Select
      value={known ? toRadix(value) : ""}
      onValueChange={(v) => onValueChange(fromRadix(v))}
      name={name}
      disabled={disabled}
      required={required}
    >
      <SelectTrigger size={size} className={className} {...aria}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className={contentClassName}>
        {options.map((o) => (
          <SelectItem key={o.value} value={toRadix(o.value)} disabled={o.disabled} description={o.description}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
