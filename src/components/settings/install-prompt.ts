"use client";

// Chromium's install prompt (`beforeinstallprompt`) usually fires once, right
// after the page loads, long before anyone opens Settings → App & Updates.
// This module keeps the event app-wide: the shell's PushToggle (loaded on every
// page) imports it, so the listener exists from the first paint on. No
// preventDefault(): the browser's own install UI keeps working; the section
// only offers a second way to open the same dialog.

import { useSyncExternalStore } from "react";

/** The non-standard install prompt event (Chromium). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    emit();
  });
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** True while the browser offers its install dialog for this app. */
export function useCanInstall(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => deferred !== null,
    () => false,
  );
}

/**
 * Opens the browser's install dialog (needs a user gesture). An event can be
 * used once; "unavailable" when it is gone (used by the browser's own banner,
 * or never offered).
 */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const e = deferred;
  if (!e) return "unavailable";
  deferred = null;
  emit();
  try {
    await e.prompt();
    return (await e.userChoice).outcome;
  } catch {
    return "unavailable";
  }
}
