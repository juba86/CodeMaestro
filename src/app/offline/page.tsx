import type { Metadata } from "next";
import Link from "next/link";
import { WifiOff } from "lucide-react";
import { RetryButton } from "./retry-button";

// Precached by the service worker (public/sw.js) and served in place of any
// page that cannot be loaded. Static and dependency-free so it renders from
// the cache; the retry link and the plain link below also work without
// JavaScript. The app shell renders this route bare (no sidebar or tab bar).
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Offline · CodeMaestro",
};

export default function OfflinePage() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4 pb-safe pt-safe">
      <div className="flex max-w-md flex-col items-center gap-4 py-10 text-center">
        <span
          aria-hidden="true"
          className="grid size-14 place-items-center rounded-xl border border-warning-border bg-card bg-linear-to-r from-warning-subtle to-warning-subtle text-warning"
        >
          <WifiOff className="size-7" />
        </span>
        <h1 className="text-xl font-semibold tracking-[-0.01em]">Keine Verbindung zu CodeMaestro</h1>
        <p className="text-sm text-muted-foreground">
          Dein Server ist gerade nicht erreichbar. Prüfe Tailscale oder dein Netz. Laufende Sessions arbeiten auf
          dem Server weiter.
        </p>
        <div className="mt-2 flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
          <RetryButton />
          {/* Renders a plain <a>, so it also works before/without hydration. */}
          <Link
            href="/"
            prefetch={false}
            className="inline-flex h-10 items-center rounded-md px-2 text-sm text-primary-text underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:h-8 md:text-ui"
          >
            Zur Startseite
          </Link>
        </div>
      </div>
    </div>
  );
}
