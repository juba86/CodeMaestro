"use client";

import * as React from "react";
import { cn } from "./cn";
import { useFieldControl } from "./field";

export type TextareaProps = React.ComponentProps<"textarea"> & {
  /** Grow with the content between `min` and `max` rows (then scroll). */
  autosize?: { min?: number; max?: number };
};

function fit(el: HTMLTextAreaElement, min: number, max: number) {
  const cs = window.getComputedStyle(el);
  const line = parseFloat(cs.lineHeight) || 20;
  const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  const border = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
  const minH = min * line + pad + border;
  const maxH = max * line + pad + border;
  el.style.height = "auto";
  const wanted = el.scrollHeight + border;
  el.style.height = `${Math.min(Math.max(wanted, minH), maxH)}px`;
  el.style.overflowY = wanted > maxH ? "auto" : "hidden";
}

export function Textarea({ className, autosize, ref, onInput, rows, ...props }: TextareaProps) {
  const a11y = useFieldControl(props);
  const inner = React.useRef<HTMLTextAreaElement | null>(null);
  const min = autosize ? Math.max(1, autosize.min ?? 1) : 0;
  const max = autosize ? Math.max(min, autosize.max ?? 8) : 0;

  const setRef = React.useCallback(
    (el: HTMLTextAreaElement | null) => {
      inner.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) (ref as React.RefObject<HTMLTextAreaElement | null>).current = el;
    },
    [ref],
  );

  // Re-fit on value changes (controlled) and on width changes (re-wrapping).
  React.useLayoutEffect(() => {
    const el = inner.current;
    if (!el || !autosize) return;
    fit(el, min, max);
  }, [autosize, min, max, props.value]);

  React.useEffect(() => {
    const el = inner.current;
    if (!el || !autosize || typeof ResizeObserver === "undefined") return;
    let width = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fit(el, min, max);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [autosize, min, max]);

  return (
    <textarea
      data-slot="textarea"
      ref={setRef}
      rows={rows ?? (autosize ? min : 3)}
      onInput={(e) => {
        if (autosize) fit(e.currentTarget, min, max);
        onInput?.(e);
      }}
      className={cn(
        "flex w-full rounded-md border border-input bg-background px-3 py-2 text-base text-foreground",
        "placeholder:text-subtle-foreground md:text-ui disabled:cursor-not-allowed disabled:opacity-50",
        "aria-[invalid=true]:border-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        autosize ? "resize-none" : "min-h-20 resize-y",
        className,
      )}
      {...a11y}
    />
  );
}
