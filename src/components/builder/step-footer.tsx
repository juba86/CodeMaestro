"use client";

import { useRef, type ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import { useBottomChrome } from "@/components/ui/toaster";
import { useIsMobile } from "@/hooks/use-media-query";

/**
 * Step navigation row: sticky above the tab bar on phones (full-bleed, thumb
 * zone; toasts are lifted above it), an ordinary row under the form from md up.
 */
export function StepFooter({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  useBottomChrome(ref, isMobile);
  return (
    <div
      ref={ref}
      className={cn(
        // main pads 16px on phones and sticky offsets count from inside that
        // padding: -bottom-4 puts the bar flush on the tab bar.
        "sticky -bottom-4 z-10 -mx-4 -mb-4 mt-6 flex items-center gap-2 border-t border-border bg-background/95 px-4 py-3",
        "backdrop-blur supports-[backdrop-filter]:bg-background/85 [&>*]:min-w-0 [&>*]:flex-1",
        "md:static md:mx-0 md:mb-0 md:flex-wrap md:border-0 md:bg-transparent md:px-0 md:pb-0 md:pt-2 md:backdrop-blur-none md:[&>*]:flex-none",
        className,
      )}
    >
      {children}
    </div>
  );
}
