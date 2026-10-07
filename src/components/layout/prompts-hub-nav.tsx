"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/components/ui/cn";
import { PROMPT_HUB_ITEMS, matchesRoute } from "./nav-config";

/**
 * Mobile sub-navigation on the four prompt pages (DESIGN.md §5.3): a
 * horizontally scrollable segmented row of links, Bibliothek · Builder ·
 * Vorlagen · Playground.
 */
export function PromptsHubNav({ pathname }: { pathname: string }) {
  const ref = React.useRef<HTMLElement>(null);

  // On narrow phones the row scrolls: keep the current page's segment in view.
  React.useEffect(() => {
    const nav = ref.current;
    const current = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !current) return;
    const n = nav.getBoundingClientRect();
    const c = current.getBoundingClientRect();
    if (c.left < n.left || c.right > n.right) nav.scrollLeft += c.left - n.left - 16;
  }, [pathname]);

  return (
    <nav
      ref={ref}
      aria-label="Prompts"
      className="shrink-0 overflow-x-auto border-b border-border bg-background px-4 py-2 scrollbar-none md:hidden"
    >
      <ul className="inline-flex h-11 min-w-full items-center gap-0.5 rounded-md border border-border bg-surface-2 p-0.5">
        {PROMPT_HUB_ITEMS.map((item) => {
          const active = matchesRoute(pathname, item.href);
          return (
            <li key={item.href} className="h-full flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-full w-full items-center justify-center whitespace-nowrap rounded-[5px] px-3 text-sm font-medium text-muted-foreground transition-colors duration-150",
                  "hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                  "aria-[current=page]:bg-card aria-[current=page]:text-foreground aria-[current=page]:shadow-sm",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
