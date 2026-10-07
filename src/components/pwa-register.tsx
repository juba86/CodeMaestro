"use client";

import { useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

// Don't hammer the server with update checks when the user flips tabs a lot.
const UPDATE_CHECK_INTERVAL_MS = 60_000;

/** Lets open screens save drafts before the update reload (DESIGN.md §6.10, §9.2). */
function announceReload() {
  window.dispatchEvent(new Event("cm:before-update-reload"));
}

/**
 * Registers the service worker — only in a secure context (HTTPS, e.g. via
 * `tailscale serve`, or localhost). Over plain http:// on a tailnet IP
 * `navigator.serviceWorker` is undefined, so this is a no-op.
 *
 * Updates: when a new worker is waiting, a toast (DESIGN.md §6.10) offers
 * "Neu laden", which activates it and reloads this tab once. Right before
 * that, `cm:before-update-reload` is dispatched on window so open screens can
 * save drafts (the assistant composer). Other open tabs keep running (the
 * worker never caches HTML, so they stay consistent) and pick it up on their
 * next navigation.
 */
export function PwaRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !window.isSecureContext || !("serviceWorker" in navigator)) return;
    const sw = navigator.serviceWorker;
    let disposed = false;
    let registration: ServiceWorkerRegistration | null = null;
    let userRequestedUpdate = false;
    let lastCheck = 0;

    const promptUpdate = (worker: ServiceWorker) => {
      if (disposed) return;
      toast("Neue Version verfügbar", {
        id: "sw-update",
        duration: Infinity,
        icon: <RefreshCw />,
        description: "Neu laden, um sie zu nutzen. Laufende Sessions laufen weiter.",
        action: {
          label: "Neu laden",
          onClick: () => {
            // Already took over on its own (it replaces the legacy worker right
            // away) — this tab only still shows the old version.
            if (worker.state === "activating" || worker.state === "activated") {
              announceReload();
              window.location.reload();
              return;
            }
            userRequestedUpdate = true;
            announceReload();
            worker.postMessage({ type: "SKIP_WAITING" });
          },
        },
        cancel: { label: "Später", onClick: () => {} },
      });
    };

    const onUpdateFound = () => {
      const next = registration?.installing;
      if (!next) return;
      next.addEventListener("statechange", () => {
        // Without a controller this is the first install — nothing to update.
        if (next.state === "installed" && sw.controller) promptUpdate(next);
      });
    };

    const onControllerChange = () => {
      if (!userRequestedUpdate) return;
      userRequestedUpdate = false;
      window.location.reload();
    };

    const onMessage = (event: MessageEvent) => {
      // Sent by the worker on a notification click it could not navigate itself.
      const data = event.data as { type?: string; url?: string } | null;
      if (data?.type !== "NAVIGATE" || typeof data.url !== "string") return;
      try {
        const target = new URL(data.url, window.location.origin);
        if (target.origin === window.location.origin) window.location.assign(target.href);
      } catch {
        /* ignore malformed URLs */
      }
    };

    const onVisible = () => {
      if (document.visibilityState !== "visible" || !registration) return;
      const now = Date.now();
      if (now - lastCheck < UPDATE_CHECK_INTERVAL_MS) return;
      lastCheck = now;
      registration.update().catch(() => {});
    };

    sw.addEventListener("controllerchange", onControllerChange);
    sw.addEventListener("message", onMessage);
    document.addEventListener("visibilitychange", onVisible);

    sw.register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((reg) => {
        if (disposed) return;
        registration = reg;
        lastCheck = Date.now();
        // A worker that finished installing while no tab was open.
        if (reg.waiting && sw.controller) promptUpdate(reg.waiting);
        reg.addEventListener("updatefound", onUpdateFound);
      })
      .catch((err) => {
        console.warn("[pwa] service worker registration failed", err);
      });

    return () => {
      disposed = true;
      registration?.removeEventListener("updatefound", onUpdateFound);
      sw.removeEventListener("controllerchange", onControllerChange);
      sw.removeEventListener("message", onMessage);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
