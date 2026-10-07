import type * as React from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "./cn";

export type AppBarProps = Omit<React.ComponentProps<"header">, "title"> & {
  /** Back link; the label is visible when `showLabel` is true, else sr-only. */
  back?: { href: string; label: string; showLabel?: boolean };
  title: React.ReactNode;
  /** Second line (status, agent · model), truncated. */
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  /** Element for the title (default div: PageHeader owns the h1). */
  titleAs?: "div" | "h1" | "h2";
};

/** Mobile app bar: sticky, safe-area aware, 56px row. */
export function AppBar({ back, title, subtitle, actions, titleAs = "div", className, children, ...props }: AppBarProps) {
  const Title = titleAs;
  return (
    <header
      data-slot="app-bar"
      className={cn(
        "sticky top-0 z-20 shrink-0 border-b border-border bg-background/95 pt-safe backdrop-blur supports-[backdrop-filter]:bg-background/80",
        className,
      )}
      {...props}
    >
      <div className={cn("flex h-14 items-center gap-1 pr-2", back ? "pl-1" : "pl-4")}>
        {back ? (
          <Link
            href={back.href}
            className={cn(
              "inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-0.5 rounded-md text-primary-text hover:bg-accent",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              back.showLabel && "pl-1 pr-2",
            )}
          >
            <ChevronLeft aria-hidden className="size-6" />
            <span className={back.showLabel ? "text-sm font-medium" : "sr-only"}>{back.label}</span>
          </Link>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <Title className="truncate text-base font-semibold leading-6">{title}</Title>
          {subtitle ? (
            <div className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground">{subtitle}</div>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>
      {children}
    </header>
  );
}
