import { Suspense } from "react";
import type { Metadata } from "next";
import { SettingsView } from "@/components/settings/settings-view";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = {
  title: "Einstellungen · CodeMaestro",
};

function SettingsFallback() {
  return (
    <div className="mx-auto w-full max-w-[1000px]" aria-busy>
      <span className="sr-only" role="status">
        Einstellungen werden geladen …
      </span>
      <Skeleton className="mb-6 hidden h-7 w-40 md:block" />
      <div className="flex flex-col gap-2 md:grid md:grid-cols-[200px_minmax(0,1fr)] md:gap-6 lg:grid-cols-[220px_minmax(0,720px)] lg:gap-10">
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full md:h-8" />
          ))}
        </div>
        <Skeleton className="hidden h-64 w-full md:block" />
      </div>
    </div>
  );
}

// useSearchParams (?section=) needs a Suspense boundary for static rendering.
export default function SettingsPage() {
  return (
    <Suspense fallback={<SettingsFallback />}>
      <SettingsView />
    </Suspense>
  );
}
