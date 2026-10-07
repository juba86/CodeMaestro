"use client";

import type * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./cn";
import { useFieldControl } from "./field";

export const inputVariants = cva(
  "flex w-full rounded-md border border-input bg-background px-3 text-base text-foreground " +
    "placeholder:text-subtle-foreground md:text-ui disabled:cursor-not-allowed disabled:opacity-50 " +
    "aria-[invalid=true]:border-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring " +
    "file:border-0 file:bg-transparent file:text-ui file:font-medium",
  { variants: { size: { sm: "h-9 md:h-7", md: "h-10 md:h-8", lg: "h-11 md:h-10" } }, defaultVariants: { size: "md" } },
);

export type InputProps = Omit<React.ComponentProps<"input">, "size"> & VariantProps<typeof inputVariants>;

export function Input({ className, size, type = "text", ...props }: InputProps) {
  const a11y = useFieldControl(props);
  return <input data-slot="input" type={type} className={cn(inputVariants({ size }), className)} {...a11y} />;
}

export type InputGroupProps = InputProps & {
  /** Decorative leading icon or text (e.g. a Search icon). */
  leading?: React.ReactNode;
  /** Trailing controls (icon buttons, a unit, a Kbd). */
  trailing?: React.ReactNode;
  /** Class for the wrapper element. */
  groupClassName?: string;
};

/** Input with leading and/or trailing slots. Pass padding overrides via className when the trailing slot is wide. */
export function InputGroup({ leading, trailing, groupClassName, className, ...props }: InputGroupProps) {
  return (
    <div data-slot="input-group" className={cn("relative flex w-full items-center", groupClassName)}>
      {leading ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-subtle-foreground [&_svg]:size-4"
        >
          {leading}
        </span>
      ) : null}
      <Input className={cn(leading && "pl-9", trailing && "pr-10 md:pr-9", className)} {...props} />
      {trailing ? (
        <span className="absolute inset-y-0 right-0 flex items-center gap-0.5 pr-1 text-subtle-foreground">{trailing}</span>
      ) : null}
    </div>
  );
}
