"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Download, RefreshCw, Share, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Skeleton } from "@/components/ui/skeleton";
import { version as APP_VERSION } from "../../../package.json";
import { promptInstall, useCanInstall } from "./install-prompt";
import { InfoRows, SectionHeader, SettingsCard } from "./settings-ui";

export { APP_VERSION };

type SwState = "checking" | "unsupported" | "none" | "installing" | "waiting" | "active";

const SW_LABEL: Record<Exclude<SwState, "checking">, string> = {
  unsupported: "nicht registriert",
  none: "nicht registriert",
  installing: "wird installiert …",
  waiting: "Update wartet",
  active: "aktiv",
};

function swSupported(): boolean {
  return typeof window !== "undefined" && window.isSecureContext && "serviceWorker" in navigator;
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!swSupported()) return null;
  return (await navigator.serviceWorker.getRegistration("/")) ?? null;
}

function stateOf(reg: ServiceWorkerRegistration | null): SwState {
  if (!swSupported()) return "unsupported";
  if (!reg) return "none";
  if (reg.waiting) return "waiting";
  if (reg.installing && !reg.active) return "installing";
  return reg.active ? "active" : "installing";
}

const noop = () => () => {};

function useDisplayInfo() {
  return useSyncExternalStore(
    noop,
    () => {
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        window.matchMedia("(display-mode: window-controls-overlay)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true;
      const ios =
        /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      return standalone ? (ios ? "standalone-ios" : "standalone") : ios ? "ios" : "browser";
    },
    () => "unknown" as const,
  );
}

export function AppSection() {
  const [sw, setSw] = useState<SwState>("checking");
  const [checking, setChecking] = useState(false);
  const canInstall = useCanInstall();
  const display = useDisplayInfo();

  const refresh = useCallback(async () => {
    try {
      setSw(stateOf(await getRegistration()));
    } catch {
      setSw("none");
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (!swSupported()) return;
    const sw = navigator.serviceWorker;
    const onChange = () => void refresh();
    sw.addEventListener("controllerchange", onChange);
    // A worker may finish installing while this section is open.
    const timer = setInterval(onChange, 5_000);
    return () => {
      sw.removeEventListener("controllerchange", onChange);
      clearInterval(timer);
    };
  }, [refresh]);

  async function checkForUpdates() {
    setChecking(true);
    try {
      const reg = await getRegistration();
      if (!reg) {
        toast.error("Kein Service Worker registriert", { description: "Updates gibt es nur über HTTPS (z. B. tailscale serve)." });
        return;
      }
      if (reg.installing) {
        // Nothing to compare against yet: the current worker is still installing.
        setSw(stateOf(reg));
        toast("Service Worker wird gerade installiert …");
        return;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          reg.update(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("timeout")), 15_000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      setSw(stateOf(reg));
      // A new worker shows the „Neue Version verfügbar" toast (PwaRegister) once installed.
      if (reg.installing) toast("Neue Version wird geladen …");
      else if (reg.waiting) toast("Eine neue Version wartet", { description: "Mit „Neu laden“ aktivierst du sie." });
      else toast.success("Du hast die neueste Version");
    } catch {
      toast.error("Suche fehlgeschlagen: Server nicht erreichbar");
    } finally {
      setChecking(false);
    }
  }

  async function activateWaiting() {
    const reg = await getRegistration().catch(() => null);
    const worker = reg?.waiting;
    // Open screens save drafts first (DESIGN.md §6.10), same as the update toast.
    window.dispatchEvent(new Event("cm:before-update-reload"));
    if (!worker) {
      window.location.reload();
      return;
    }
    navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), { once: true });
    worker.postMessage({ type: "SKIP_WAITING" });
  }

  async function install() {
    const outcome = await promptInstall();
    if (outcome === "accepted") toast.success("App wird installiert");
    else if (outcome === "unavailable") {
      toast("Installieren über das Browser-Menü", { description: "„App installieren“ im Menü oder das Symbol in der Adressleiste wählen." });
    }
  }

  const swBadge =
    sw === "checking" ? (
      <Skeleton className="h-5 w-20 rounded-full" />
    ) : (
      <Badge variant={sw === "active" ? "success" : sw === "waiting" ? "warning" : "neutral"} dot>
        {SW_LABEL[sw]}
      </Badge>
    );

  const installed = display === "standalone" || display === "standalone-ios";

  return (
    <div className="space-y-4">
      <SectionHeader title="App & Updates" description="Version, Offline-Unterstützung und Installation als App." />

      <SettingsCard
        title="CodeMaestro"
        description="Neue Versionen lädt der Service Worker im Hintergrund; laufende Sessions laufen beim Neuladen weiter."
        icon={<RefreshCw />}
        footer={
          <>
            <Button variant="outline" onClick={() => void checkForUpdates()} loading={checking} disabledReason={sw === "unsupported" ? "Benötigt HTTPS (z. B. tailscale serve)" : undefined}>
              <RefreshCw />
              Nach Updates suchen
            </Button>
            {sw === "waiting" ? (
              <Button variant="primary" onClick={() => void activateWaiting()}>
                Neu laden
              </Button>
            ) : null}
          </>
        }
      >
        <InfoRows
          rows={[
            { label: "Version", value: <span className="font-mono tabular-nums">{APP_VERSION}</span> },
            { label: "Service Worker", value: swBadge },
          ]}
        />
        {sw === "unsupported" ? (
          <p className="mt-3 text-xs text-muted-foreground md:text-ui">
            Über unverschlüsseltes HTTP gibt es keinen Service Worker: kein Offline-Modus, keine Updates im Hintergrund,
            kein Push. Öffne CodeMaestro über HTTPS (z. B. <code className="font-mono">tailscale serve</code>).
          </p>
        ) : null}
      </SettingsCard>

      <SettingsCard title="Als App installieren" description="Zum Home-Bildschirm hinzufügen für Vollbild und Push." icon={<Smartphone />}>
        {display === "unknown" ? (
          <Skeleton className="h-10 w-full" />
        ) : installed ? (
          <Callout variant="success" title="Installiert">
            CodeMaestro läuft als App auf diesem Gerät.
          </Callout>
        ) : canInstall ? (
          <Button variant="primary" onClick={() => void install()}>
            <Download />
            App installieren
          </Button>
        ) : display === "ios" ? (
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-foreground md:text-ui">
            <li>
              In Safari unten auf <Share aria-hidden className="inline size-4 align-text-bottom text-primary-text" /> „Teilen“
              tippen.
            </li>
            <li>„Zum Home-Bildschirm“ wählen und bestätigen.</li>
            <li>CodeMaestro künftig über das neue Symbol öffnen – erst dann sind Push-Benachrichtigungen möglich (ab iOS 16.4).</li>
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground md:text-ui">
            In Chrome oder Edge über das Installieren-Symbol in der Adressleiste oder im Browser-Menü „App installieren“
            wählen. Installieren geht nur über HTTPS.
          </p>
        )}
      </SettingsCard>
    </div>
  );
}
