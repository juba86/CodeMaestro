"use client";

import { useSyncExternalStore } from "react";
import { Bell, BellOff, BellRing, Send } from "lucide-react";
import { toast } from "sonner";
import { Button, IconButton } from "@/components/ui/button";
import { SwitchRow } from "@/components/ui/switch";
// Side effect: catches the browser's install prompt app-wide (every page loads
// this module through the shell) for Settings → App & Updates.
import "@/components/settings/install-prompt";

/**
 * Push state of this device:
 * - `insecure`: no secure context (plain http on a tailnet IP) — needs HTTPS.
 * - `unsupported`: secure, but the browser has no Web Push (iOS outside the installed app).
 * - `denied`: blocked in the browser's site settings.
 */
export type PushState = "checking" | "insecure" | "unsupported" | "denied" | "off" | "on" | "busy";

export interface PushSnapshot {
  status: PushState;
  /** This device's subscription endpoint while `on`. */
  endpoint: string | null;
}

const INSECURE_HINT = "Benötigt HTTPS (z. B. tailscale serve)";
const UNSUPPORTED_HINT = "Nicht unterstützt – auf dem iPhone erst ‚Zum Home-Bildschirm' hinzufügen";
const DENIED_HINT = "Im Browser blockiert – in den Website-Einstellungen erlauben";

/** Honest German state text (Settings → Benachrichtigungen, home status list). */
export const PUSH_STATE_TEXT: Record<PushState, string> = {
  checking: "Wird geprüft …",
  insecure: INSECURE_HINT,
  unsupported: UNSUPPORTED_HINT,
  denied: DENIED_HINT,
  off: "Aus",
  on: "Aktiv",
  busy: "Wird geändert …",
};

/** States in which the user cannot switch push on from here. */
export function pushUnavailable(status: PushState): boolean {
  return status === "insecure" || status === "unsupported" || status === "denied";
}

function detectSupport(): "insecure" | "unsupported" | "ok" {
  if (typeof window === "undefined") return "unsupported";
  if (!window.isSecureContext) return "insecure";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  return "ok";
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

/** Sends a test notification to this device (or every device without an endpoint). */
export async function sendPushTest(endpoint?: string): Promise<void> {
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

// ---------------------------------------------------------------------------
// Module-level store: every toggle on the page (sidebar, Mehr sheet, settings,
// home) shows the same state, and the quiet re-sync runs once per page load.
// ---------------------------------------------------------------------------

const SERVER_SNAPSHOT: PushSnapshot = { status: "checking", endpoint: null };
let snapshot: PushSnapshot = SERVER_SNAPSHOT;
let initialized = false;
const listeners = new Set<() => void>();

function set(next: PushSnapshot) {
  if (next.status === snapshot.status && next.endpoint === snapshot.endpoint) return;
  snapshot = next;
  for (const l of listeners) l();
}

// Initial state + quiet re-sync: if this device is subscribed, re-send the
// subscription (server DB reset) and resubscribe when the server key changed.
async function init() {
  const support = detectSupport();
  if (support !== "ok") {
    set({ status: support, endpoint: null });
    return;
  }
  if (Notification.permission === "denied") {
    set({ status: "denied", endpoint: null });
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
    set({ status: sub ? "on" : "off", endpoint: sub?.endpoint ?? null });
  } catch {
    set({ status: "off", endpoint: null });
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!initialized) {
    initialized = true;
    void init();
  }
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => snapshot;
const getServerSnapshot = () => SERVER_SNAPSHOT;

/** Subscribes this device to Web Push (asks for permission first). */
export async function enablePush(): Promise<void> {
  set({ status: "busy", endpoint: snapshot.endpoint });
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      set({ status: permission === "denied" ? "denied" : "off", endpoint: null });
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
    set({ status: "on", endpoint: ep });
    toast.success("Benachrichtigungen aktiviert", {
      description: "Du wirst informiert, wenn der Assistent dich braucht oder fertig ist.",
      action: { label: "Test", onClick: () => void sendPushTest(ep) },
    });
  } catch (err) {
    set({ status: "off", endpoint: null });
    toast.error(err instanceof Error ? err.message : "Benachrichtigungen konnten nicht aktiviert werden.");
  }
}

/** Removes this device's subscription (server and browser). */
export async function disablePush(): Promise<void> {
  const prev = snapshot;
  set({ status: "busy", endpoint: prev.endpoint });
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
    set({ status: "off", endpoint: null });
    toast("Benachrichtigungen deaktiviert.");
  } catch (err) {
    set({ status: "on", endpoint: prev.endpoint });
    toast.error(err instanceof Error ? err.message : "Deaktivieren fehlgeschlagen.");
  }
}

/** This device's push state, shared by every caller. "checking" on the server. */
export function usePushState(): PushSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

export interface PushToggleProps {
  /** Icon button size (default `icon`: 40px on phones, 32px from md). */
  size?: "icon-sm" | "icon" | "icon-lg";
  className?: string;
}

/**
 * Bell icon button (sidebar footer, Mehr sheet): subscribes this device to
 * Web Push so it is notified when an assistant run needs an approval/answer or
 * finishes while no window is watching. Needs a secure context (HTTPS via
 * `tailscale serve`); on iOS only inside the installed app (Home Screen),
 * iOS ≥ 16.4.
 */
export function PushToggle({ size = "icon", className }: PushToggleProps = {}) {
  const { status, endpoint } = usePushState();

  const onClick = () => {
    if (status === "off") {
      void enablePush();
    } else if (status === "on") {
      // Two-step: a stray tap must not silently turn notifications off.
      toast("Benachrichtigungen sind aktiv", {
        id: "push-toggle",
        action: { label: "Test", onClick: () => void sendPushTest(endpoint ?? undefined) },
        cancel: { label: "Deaktivieren", onClick: () => void disablePush() },
      });
    }
  };

  const unavailable = pushUnavailable(status);
  const label =
    status === "on" ? "Push-Benachrichtigungen aktiv" : unavailable ? "Push-Benachrichtigungen" : "Push-Benachrichtigungen aktivieren";
  const Icon = status === "on" ? BellRing : unavailable ? BellOff : Bell;

  return (
    <IconButton
      // Remount when switching between the plain tooltip and the controlled
      // disabled-reason tooltip (Radix warns on controlled ⇄ uncontrolled).
      key={unavailable ? "blocked" : "ready"}
      size={size}
      className={className}
      aria-label={label}
      aria-pressed={unavailable ? undefined : status === "on"}
      tooltip={unavailable ? undefined : label}
      disabledReason={unavailable ? PUSH_STATE_TEXT[status] : undefined}
      disabled={status === "checking"}
      loading={status === "busy"}
      onClick={onClick}
    >
      <Icon />
    </IconButton>
  );
}

/**
 * Settings → Benachrichtigungen: the switch with honest state text and
 * [Test senden]. Same store as the PushToggle bell.
 */
export function PushSettingsCard({ className }: { className?: string }) {
  const { status, endpoint } = usePushState();
  const unavailable = pushUnavailable(status);
  const busy = status === "busy" || status === "checking";
  return (
    <div className={className}>
      <SwitchRow
        icon={status === "on" ? <BellRing /> : unavailable ? <BellOff /> : <Bell />}
        label="Push auf diesem Gerät"
        description={
          <span className={unavailable ? "text-warning" : undefined} aria-live="polite">
            {PUSH_STATE_TEXT[status]}
          </span>
        }
        checked={status === "on"}
        disabled={unavailable || busy}
        onCheckedChange={(on) => void (on ? enablePush() : disablePush())}
      />
      <div className="flex flex-wrap items-center gap-2 pl-7 pt-1">
        <Button
          variant="outline"
          onClick={() => void sendPushTest(endpoint ?? undefined)}
          disabledReason={status === "on" ? undefined : "Erst Push auf diesem Gerät aktivieren"}
        >
          <Send />
          Test senden
        </Button>
      </div>
    </div>
  );
}
