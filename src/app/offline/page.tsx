import type { Metadata } from "next";
import Link from "next/link";
import { WifiOff } from "lucide-react";
import { RetryButton } from "./retry-button";

// Precached by the service worker (public/sw.js) and served in place of any
// page that cannot be loaded. Static and dependency-free so it renders from
// the cache; the plain link below also works without JavaScript.
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Offline · CodeMaestro",
};

export default function OfflinePage() {
  return (
    <div className="flex min-h-full items-center justify-center">
      <div className="max-w-md space-y-4 text-center">
        <WifiOff className="mx-auto text-muted-foreground" size={40} aria-hidden="true" />
        <h1 className="text-xl font-semibold">Offline – CodeMaestro ist nicht erreichbar</h1>
        <p className="text-sm text-muted-foreground">
          Die Verbindung zum Server ist unterbrochen. Läuft der CodeMaestro-Server, und ist dieses Gerät mit
          dem Tailnet verbunden? Laufende Aufgaben des Code Assistants arbeiten auf dem Server weiter und sind
          nach dem Neuladen wieder sichtbar.
        </p>
        <div className="flex items-center justify-center gap-3">
          <RetryButton />
          {/* Renders a plain <a>, so it also works before/without hydration. */}
          <Link
            href="/"
            prefetch={false}
            className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            Zur Startseite
          </Link>
        </div>
      </div>
    </div>
  );
}
