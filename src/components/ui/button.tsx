"use client";

import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./cn";
import { Kbd } from "./kbd";
import { Spinner } from "./spinner";
import { SimpleTooltip } from "./tooltip";

export const buttonVariants = cva(
  "inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium " +
    "transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring " +
    "disabled:pointer-events-none disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 " +
    "[&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
        secondary: "bg-muted text-foreground hover:bg-accent",
        outline: "border border-border-strong bg-card text-foreground hover:bg-accent",
        ghost: "text-muted-foreground hover:bg-accent hover:text-foreground",
        danger: "bg-danger-solid text-primary-foreground hover:bg-danger-solid/90",
        "danger-outline": "border border-danger-border text-danger hover:bg-danger-subtle",
        "danger-ghost": "text-danger hover:bg-danger-subtle",
        link: "h-auto px-0 text-primary-text underline-offset-4 hover:underline",
      },
      size: {
        xs: "h-7 px-2 text-xs md:h-6",
        sm: "h-9 px-3 text-xs md:h-7 md:px-2.5",
        md: "h-10 px-3.5 text-sm md:h-8 md:px-3 md:text-ui",
        lg: "h-11 px-4 text-sm md:h-10",
        xl: "h-12 px-4 text-base md:h-10 md:text-sm",
        "icon-sm": "size-8 md:size-7",
        icon: "size-10 md:size-8",
        "icon-lg": "size-11 md:size-10",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>["size"]>;

export type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    /** Render the single child element (e.g. a Link) with button styling. */
    asChild?: boolean;
    /** Keeps the label, adds a spinner, sets aria-busy and ignores clicks. */
    loading?: boolean;
    /**
     * Why the action is unavailable. The button stays focusable
     * (aria-disabled), ignores clicks and explains itself in a tooltip and
     * via aria-describedby.
     */
    disabledReason?: string;
    /** Keyboard shortcut hint, e.g. "A" or "⌘S" (desktop only, decorative). */
    kbd?: string;
    /** Tooltip shown on hover/focus (ignored while `disabledReason` is set). */
    tooltip?: React.ReactNode;
  };

const isIconSize = (size: ButtonSize | null | undefined) =>
  size === "icon" || size === "icon-sm" || size === "icon-lg";

export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabledReason,
  kbd,
  tooltip,
  type,
  onClick,
  children,
  "aria-describedby": describedBy,
  ...props
}: ButtonProps) {
  const reasonId = React.useId();
  const blocked = Boolean(disabledReason);
  const iconOnly = isIconSize(size);
  // Tooltips never open on touch; a tap on a blocked button shows the reason instead.
  const [reasonOpen, setReasonOpen] = React.useState(false);
  // Once unblocked, forget an open reason so it cannot pop up when blocked again.
  if (!blocked && reasonOpen) setReasonOpen(false);

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (blocked || loading) {
      // preventDefault also stops the tooltip trigger from closing the reason again.
      e.preventDefault();
      e.stopPropagation();
      if (blocked) setReasonOpen(true);
      return;
    }
    onClick?.(e);
  };

  const kbdNode = kbd ? (
    <Kbd aria-hidden variant={variant === "primary" ? "on-primary" : "default"} className="hidden md:inline-flex">
      {kbd}
    </Kbd>
  ) : null;

  // Hidden but referenced: excluded from the button's name, read as its description.
  const reasonNode = blocked ? (
    <span id={reasonId} hidden>
      {disabledReason}
    </span>
  ) : null;

  const shared = {
    "data-slot": "button",
    className: cn(buttonVariants({ variant, size }), className),
    "aria-disabled": blocked || undefined,
    "aria-busy": loading || undefined,
    "aria-describedby": [describedBy, blocked ? reasonId : null].filter(Boolean).join(" ") || undefined,
    onClick: handleClick,
  };

  // With asChild, Slottable marks the element that receives the button props;
  // its siblings (spinner, kbd, reason) are merged into that element. They must
  // be direct children (not wrapped in a fragment) for Slot to find them.
  const button = asChild ? (
    <Slot.Root {...shared} {...props}>
      {loading && !iconOnly ? <Spinner /> : null}
      <Slot.Slottable>{children}</Slot.Slottable>
      {kbdNode}
      {reasonNode}
    </Slot.Root>
  ) : (
    <button type={type ?? "button"} {...shared} {...props}>
      {loading ? <Spinner /> : null}
      {loading && iconOnly ? null : children}
      {kbdNode}
      {reasonNode}
    </button>
  );

  if (blocked) {
    return (
      <SimpleTooltip content={disabledReason} open={reasonOpen} onOpenChange={setReasonOpen}>
        {button}
      </SimpleTooltip>
    );
  }
  return tooltip ? <SimpleTooltip content={tooltip}>{button}</SimpleTooltip> : button;
}

export type IconButtonProps = Omit<ButtonProps, "size" | "aria-label" | "kbd"> & {
  /** Required: icon buttons have no visible text. */
  "aria-label": string;
  size?: "icon-sm" | "icon" | "icon-lg";
};

export function IconButton({ variant = "ghost", size = "icon", ...props }: IconButtonProps) {
  return <Button variant={variant} size={size} {...props} />;
}
