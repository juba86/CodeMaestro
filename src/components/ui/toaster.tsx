"use client";

import * as React from "react";
import { Toaster as Sonner } from "sonner";
import { useIsMobile } from "@/hooks/use-media-query";
import { useResolvedTheme } from "@/components/theme/theme-controller";

/* ------------------------------------------------------------------------ */
/* Bottom chrome registry: fixed bottom bars report their height so toasts   */
/* (and anything else reading --cm-bottom-chrome) sit above them.           */
/* ------------------------------------------------------------------------ */

const chrome = new Map<string, number>();

function publishChrome() {
  if (typeof document === "undefined") return;
  let sum = 0;
  for (const h of chrome.values()) sum += h;
  document.documentElement.style.setProperty("--cm-bottom-chrome", `${Math.round(sum)}px`);
}

/**
 * Register a fixed bottom element (TabBar, GateBanner, composer,
 * StickyActionBar). Its rendered height (incl. safe-area padding) is added to
 * `--cm-bottom-chrome` on <html> while it is mounted, enabled and visible
 * (display:none counts as 0, e.g. `md:hidden` bars on desktop). If the element
 * is rendered conditionally, pass that condition as `enabled`.
 */
export function useBottomChrome(ref: React.RefObject<HTMLElement | null>, enabled = true) {
  const id = React.useId();
  React.useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) {
      if (chrome.delete(id)) publishChrome();
      return;
    }
    const measure = () => {
      const visible = el.getClientRects().length > 0;
      chrome.set(id, visible ? el.getBoundingClientRect().height : 0);
      publishChrome();
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
      chrome.delete(id);
      publishChrome();
    };
  }, [ref, enabled, id]);
}

const MOBILE_OFFSET = { bottom: "calc(var(--cm-bottom-chrome) + 12px)", left: 12, right: 12 };
const DESKTOP_OFFSET = { bottom: 20, right: 20 };

/**
 * Sonner with token styling. Desktop bottom-right; mobile bottom-center above
 * the bottom chrome. The theme follows the resolved app theme.
 */
export function Toaster() {
  const theme = useResolvedTheme();
  const isMobile = useIsMobile();
  return (
    <Sonner
      theme={theme}
      position={isMobile ? "bottom-center" : "bottom-right"}
      offset={isMobile ? MOBILE_OFFSET : DESKTOP_OFFSET}
      mobileOffset={MOBILE_OFFSET}
      gap={8}
      closeButton={false}
      containerAriaLabel="Benachrichtigungen"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "0.75rem",
          "--width": "360px",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          // Text first, actions on their own row below it ([Neu laden] [Später]),
          // indented to the text when there is an icon tile (28px + 12px gap).
          toast:
            "font-sans bg-popover! text-foreground! border! border-border! shadow-lg! rounded-xl! gap-x-3! gap-y-2.5! p-3.5! items-start! flex-wrap! " +
            "[&:has(>[data-icon])>[data-content]]:pt-1 [&:has(>[data-icon])>[data-action]]:ml-10! " +
            "[&:has(>[data-icon]):not(:has(>[data-action]))>[data-cancel]]:ml-10!",
          content: "basis-[calc(100%-2.5rem)]! grow! min-w-0!",
          title: "text-ui! font-semibold! leading-5!",
          description: "text-xs! text-muted-foreground! leading-4!",
          icon:
            "size-7! m-0! justify-center! rounded-md! bg-primary-subtle! text-primary-text! [&_svg]:size-4! [&_svg]:m-0! [&_.sonner-loading-wrapper]:inset-1.5!",
          // Button size sm: 36px touch targets on phones, 28px on desktop.
          actionButton:
            "order-1 ml-0! bg-primary! text-primary-foreground! rounded-md! h-9! px-3! md:h-7! md:px-2.5! text-xs! font-medium! hover:bg-primary/90! focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!",
          cancelButton:
            "order-2 ml-0! bg-transparent! text-muted-foreground! rounded-md! h-9! px-3! md:h-7! md:px-2.5! text-xs! font-medium! hover:bg-accent! hover:text-foreground! focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!",
          closeButton: "bg-popover! border-border! text-muted-foreground!",
          success: "[&_[data-icon]]:bg-success-subtle! [&_[data-icon]]:text-success!",
          error: "[&_[data-icon]]:bg-danger-subtle! [&_[data-icon]]:text-danger!",
          warning: "[&_[data-icon]]:bg-warning-subtle! [&_[data-icon]]:text-warning!",
          info: "[&_[data-icon]]:bg-info-subtle! [&_[data-icon]]:text-info!",
        },
      }}
    />
  );
}
