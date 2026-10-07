"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, BellRing, Loader2 } from "lucide-react";
import { toast } from "sonner";

type PushState = "checking" | "unsupported" | "denied" | "off" | "on" | "busy";

const UNSUPPORTED_HINT = "Benötigt HTTPS (z. B. tailscale serve) und eine installierte App auf iOS";

function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a || a.byteLength !== b.byteLength) return false;
  const view = new Uint8Array(a);
  return view.every((v, i) => v === b[i]);
}

async function fetchPublicKey(): Promise<Uint8Array<ArrayBuffer>> {
  const res = await fetch("/api/push/vapid", { cache: "no-store" });
  if (!res.ok) throw new Error("Push-Schlüssel nicht verfügbar.");
  const { publicKey } = (await res.json()) as { publicKey?: string };
  if (!publicKey) throw new Error("Push-Schlüssel nicht verfügbar.");
  return urlBase64ToUint8Array(publicKey);
}

/** The registration with an *active* worker — pushManager.subscribe() needs one. */
async function registration(): Promise<ServiceWorkerRegistration> {
  // PwaRegister normally registered it already (possibly still installing on a
  // first visit); register here in case that failed.
  if (!(await navigator.serviceWorker.getRegistration("/"))) {
    await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Service Worker nicht bereit.")), 10_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function saveSubscription(sub: PushSubscription): Promise<void> {
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sub.toJSON()),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || "Abonnement konnte nicht gespeichert werden.");
  }
}

async function sendTest(endpoint?: string): Promise<void> {
  try {
    const res = await fetch("/api/push/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(endpoint ? { endpoint } : {}),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(data.error || "Test fehlgeschlagen.");
    toast.success("Test-Benachrichtigung gesendet.");
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Test fehlgeschlagen.");
  }
}

/**
 * Bell in the header: subscribes this device to Web Push so it is notified
 * when an assistant run needs an approval/answer or finishes while no window
 * is watching. Needs a secure context (HTTPS via `tailscale serve`); on iOS
 * only inside the installed app (Home Screen), iOS ≥ 16.4.
 */
export function PushToggle() {
  const [status, setStatus] = useState<PushState>("checking");
  const [endpoint, setEndpoint] = useState<string | null>(null);

  // Initial state + quiet re-sync: if this device is subscribed, re-send the
  // subscription (server DB reset) and resubscribe when the server key changed.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!pushSupported()) {
        setStatus("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        setStatus("denied");
        return;
      }
      try {
        const reg = await navigator.serviceWorker.getRegistration("/");
        let sub = reg ? await reg.pushManager.getSubscription() : null;
        if (sub && reg && Notification.permission === "granted") {
          const key = await fetchPublicKey();
          if (!sameKey(sub.options.applicationServerKey, key)) {
            await sub.unsubscribe().catch(() => {});
            sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
          }
          await saveSubscription(sub);
        }
        if (cancelled) return;
        setEndpoint(sub?.endpoint ?? null);
        setStatus(sub ? "on" : "off");
      } catch {
        if (!cancelled) setStatus("off");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    setStatus("busy");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "off");
        toast.error("Benachrichtigungen wurden nicht erlaubt.");
        return;
      }
      const reg = await registration();
      const key = await fetchPublicKey();
      let sub = await reg.pushManager.getSubscription();
      if (sub && !sameKey(sub.options.applicationServerKey, key)) {
        await sub.unsubscribe().catch(() => {});
        sub = null;
      }
      sub = sub ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
      await saveSubscription(sub);
      const ep = sub.endpoint;
      setEndpoint(ep);
      setStatus("on");
      toast.success("Benachrichtigungen aktiviert", {
        description: "Du wirst informiert, wenn der Assistent dich braucht oder fertig ist.",
        action: { label: "Test", onClick: () => void sendTest(ep) },
      });
    } catch (err) {
      setStatus("off");
      toast.error(err instanceof Error ? err.message : "Benachrichtigungen konnten nicht aktiviert werden.");
    }
  }, []);

  const disable = useCallback(async () => {
    setStatus("busy");
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {});
        await sub.unsubscribe();
      }
      setEndpoint(null);
      setStatus("off");
      toast("Benachrichtigungen deaktiviert.");
    } catch (err) {
      setStatus("on");
      toast.error(err instanceof Error ? err.message : "Deaktivieren fehlgeschlagen.");
    }
  }, []);

  const onClick = () => {
    if (status === "off") {
      void enable();
    } else if (status === "on") {
      // Two-step: a stray tap must not silently turn notifications off.
      toast("Benachrichtigungen sind aktiv", {
        id: "push-toggle",
        action: { label: "Test", onClick: () => void sendTest(endpoint ?? undefined) },
        cancel: { label: "Deaktivieren", onClick: () => void disable() },
      });
    }
  };

  const disabled = status === "unsupported" || status === "denied" || status === "checking" || status === "busy";
  const title =
    status === "unsupported"
      ? UNSUPPORTED_HINT
      : status === "denied"
        ? "Benachrichtigungen sind im Browser blockiert — in den Website-Einstellungen erlauben"
        : status === "on"
          ? "Push-Benachrichtigungen aktiv"
          : "Push-Benachrichtigungen aktivieren";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={status === "on"}
      className="p-2 rounded-md hover:bg-accent text-muted-foreground disabled:opacity-50 disabled:hover:bg-transparent"
    >
      {status === "busy" ? (
        <Loader2 size={16} className="animate-spin" />
      ) : status === "on" ? (
        <BellRing size={16} />
      ) : status === "off" || status === "checking" ? (
        <Bell size={16} />
      ) : (
        <BellOff size={16} />
      )}
    </button>
  );
}
