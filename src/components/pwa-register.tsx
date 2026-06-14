"use client";

import { useEffect } from "react";

/**
 * Registers the service worker — but only in a secure context (HTTPS or
 * localhost). Over plain http:// (e.g. a Tailscale IP) `navigator.serviceWorker`
 * is undefined, so this is a no-op and nothing breaks; "Add to Home screen"
 * (standalone display) still works from the manifest.
 */
export function PwaRegister() {
  useEffect(() => {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator && window.isSecureContext) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}
