"use client";

import * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";
import { cn } from "./cn";
import { useFieldControl } from "./field";

export type SwitchProps = React.ComponentProps<typeof SwitchPrimitive.Root> & { size?: "sm" | "md" };

export function Switch({ className, size = "md", ...props }: SwitchProps) {
  const a11y = useFieldControl(props);
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer relative inline-flex shrink-0 cursor-pointer items-center rounded-full border border-input bg-muted transition-colors duration-150",
        "after:absolute after:-inset-1 after:content-['']",
        "data-[state=checked]:border-primary data-[state=checked]:bg-primary",
        "disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-danger",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        size === "md" ? "h-5 w-9" : "h-4 w-7",
        className,
      )}
      {...a11y}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block translate-x-0.5 rounded-full bg-muted-foreground transition-transform duration-150",
          "data-[state=checked]:bg-primary-foreground",
          size === "md" ? "size-3.5 data-[state=checked]:translate-x-[1.125rem]" : "size-2.5 data-[state=checked]:translate-x-[0.875rem]",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export type SwitchRowProps = Omit<SwitchProps, "children"> & {
  label: React.ReactNode;
  description?: React.ReactNode;
  /** Decorative leading icon. */
  icon?: React.ReactNode;
};

/** Label + description + switch; the whole row is the click target (≥44px on mobile). */
export function SwitchRow({ label, description, icon, className, id, size, ...props }: SwitchRowProps) {
  const auto = React.useId();
  const switchId = id ?? `switch-${auto}`;
  const labelId = `${switchId}-label`;
  const descId = `${switchId}-desc`;
  return (
    <label
      htmlFor={switchId}
      data-slot="switch-row"
      data-disabled={props.disabled || undefined}
      className={cn(
        "flex min-h-11 cursor-pointer items-center gap-3 rounded-md py-2 md:min-h-10",
        "data-[disabled]:cursor-not-allowed",
        className,
      )}
    >
      {icon ? (
        <span aria-hidden className="shrink-0 self-start pt-0.5 text-subtle-foreground [&_svg]:size-4">
          {icon}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span id={labelId} className="text-sm font-medium text-foreground md:text-ui">
          {label}
        </span>
        {description ? (
          <span id={descId} className="text-ui text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
      <Switch
        id={switchId}
        size={size}
        aria-labelledby={labelId}
        aria-describedby={[description ? descId : null, props["aria-describedby"]].filter(Boolean).join(" ") || undefined}
        {...props}
      />
    </label>
  );
}
