"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Copy text to the clipboard. The app is often served over plain http on the
 * tailnet, where `navigator.clipboard` is missing; fall back to a hidden
 * textarea plus `document.execCommand("copy")`.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  if (typeof document === "undefined") return false;
  const active = document.activeElement as HTMLElement | null;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.setAttribute("aria-hidden", "true");
  ta.style.position = "fixed";
  ta.style.top = "0";
  ta.style.left = "0";
  ta.style.width = "1px";
  ta.style.height = "1px";
  ta.style.opacity = "0";
  ta.style.pointerEvents = "none";
  // 16px avoids the iOS zoom-on-focus.
  ta.style.fontSize = "16px";
  document.body.appendChild(ta);
  let ok = false;
  try {
    ta.select();
    ta.setSelectionRange(0, text.length);
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  } finally {
    document.body.removeChild(ta);
    active?.focus?.({ preventScroll: true });
  }
  return ok;
}

/** `copy(text)` plus a `copied` flag that resets after `resetMs`. */
export function useCopy(resetMs = 1600) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = useCallback(
    async (text: string) => {
      const ok = await copyText(text);
      setCopied(ok);
      if (timer.current) clearTimeout(timer.current);
      if (ok) timer.current = setTimeout(() => setCopied(false), resetMs);
      return ok;
    },
    [resetMs],
  );

  return { copied, copy };
}
