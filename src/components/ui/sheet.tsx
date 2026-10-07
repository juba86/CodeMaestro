"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "./cn";
import { useIsMobile } from "@/hooks/use-media-query";
import { IconButton } from "./button";
import { overlayClass, useReturnFocus } from "./dialog";

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetPortal = DialogPrimitive.Portal;

type Side = "right" | "bottom";

const SheetContext = React.createContext<{ side: Side; hideClose: boolean; closeLabel: string }>({
  side: "right",
  hideClose: false,
  closeLabel: "Schließen",
});

/** Which side a sheet with `side="auto"` uses right now (bottom below md, right from md). */
export function useSheetSide(side: "right" | "bottom" | "auto" = "auto"): Side {
  const isMobile = useIsMobile();
  if (side !== "auto") return side;
  return isMobile ? "bottom" : "right";
}

export function SheetOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return <DialogPrimitive.Overlay data-slot="sheet-overlay" className={cn(overlayClass, className)} {...props} />;
}

export type SheetContentProps = React.ComponentProps<typeof DialogPrimitive.Content> & {
  /** `auto` = bottom sheet below md, right sheet from md. */
  side?: "right" | "bottom" | "auto";
  /** Right sheets: md = 420px, lg = 560px. */
  size?: "md" | "lg";
  /** Hide the close button that SheetHeader renders. */
  hideClose?: boolean;
  closeLabel?: string;
};

export function SheetContent({
  className,
  children,
  side = "auto",
  size = "md",
  hideClose = false,
  closeLabel = "Schließen",
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: SheetContentProps) {
  const resolved = useSheetSide(side);
  const focus = useReturnFocus(onOpenAutoFocus, onCloseAutoFocus);
  return (
    <SheetPortal>
      <SheetOverlay />
      <DialogPrimitive.Content
        data-slot="sheet-content"
        data-side={resolved}
        onOpenAutoFocus={focus.onOpenAutoFocus}
        onCloseAutoFocus={focus.onCloseAutoFocus}
        className={cn(
          "fixed z-50 flex flex-col bg-popover text-foreground shadow-lg outline-none",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
          "data-[state=open]:duration-[260ms] data-[state=open]:ease-enter data-[state=closed]:duration-[180ms] data-[state=closed]:ease-exit",
          resolved === "bottom"
            ? "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-2xl border-t border-border-strong pl-safe pr-safe motion-safe:data-[state=open]:slide-in-from-bottom motion-safe:data-[state=closed]:slide-out-to-bottom"
            : cn(
                "inset-y-0 right-0 h-dvh w-full border-l border-border-strong pt-safe pr-safe motion-safe:data-[state=open]:slide-in-from-right motion-safe:data-[state=closed]:slide-out-to-right",
                size === "lg" ? "sm:max-w-[560px]" : "sm:max-w-[420px]",
              ),
          className,
        )}
        {...props}
      >
        <SheetContext.Provider value={{ side: resolved, hideClose, closeLabel }}>
          {resolved === "bottom" ? (
            <div aria-hidden className="flex shrink-0 justify-center pt-2">
              <span className="h-1 w-9 rounded-full bg-border-strong" />
            </div>
          ) : null}
          {children}
        </SheetContext.Provider>
      </DialogPrimitive.Content>
    </SheetPortal>
  );
}

/** Title row; renders the close button unless the sheet hides it. */
export function SheetHeader({ className, children, ...props }: React.ComponentProps<"div">) {
  const { side, hideClose, closeLabel } = React.useContext(SheetContext);
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex shrink-0 items-start gap-2 px-4", side === "bottom" ? "pb-2 pt-2" : "pb-2 pt-4", className)}
      {...props}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1 pt-1.5 md:pt-1">{children}</div>
      {hideClose ? null : (
        <DialogPrimitive.Close asChild>
          <IconButton aria-label={closeLabel} className="-mr-1.5">
            <X />
          </IconButton>
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

export function SheetTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title data-slot="sheet-title" className={cn("text-base font-semibold", className)} {...props} />;
}

export function SheetDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-ui text-muted-foreground", className)}
      {...props}
    />
  );
}

/** Scrolling middle part. */
export function SheetBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sheet-body" className={cn("min-h-0 flex-1 overflow-y-auto px-4 py-2 last:pb-[max(env(safe-area-inset-bottom),16px)]", className)} {...props} />;
}

/** Sticky action row; pads for the home indicator. */
export function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn(
        "flex shrink-0 gap-2 border-t border-border px-4 pt-3 pb-[max(env(safe-area-inset-bottom),16px)] [&>*]:flex-1 md:[&>*]:flex-none md:justify-end",
        className,
      )}
      {...props}
    />
  );
}
