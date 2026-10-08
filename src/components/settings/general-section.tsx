"use client";

import { Languages, Palette } from "lucide-react";
import { ThemeSegmented } from "@/components/theme/theme-toggle";
import { SectionHeader, SettingsCard } from "./settings-ui";

export function GeneralSection() {
  return (
    <div>
      <SectionHeader title="Allgemein" description="Darstellung und Sprache auf diesem Gerät." />
      <SettingsCard bodyClassName="divide-y divide-border p-0">
        <div className="flex min-h-12 flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Palette aria-hidden className="size-4 shrink-0 text-subtle-foreground" />
            <div>
              <p className="text-sm font-medium text-foreground md:text-ui">
                Design
              </p>
              <p className="text-xs text-muted-foreground">„System“ folgt der Einstellung des Geräts.</p>
            </div>
          </div>
          <ThemeSegmented className="self-start sm:self-auto" />
        </div>
        <div className="flex min-h-12 items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <Languages aria-hidden className="size-4 shrink-0 text-subtle-foreground" />
            <p className="text-sm font-medium text-foreground md:text-ui">Sprache</p>
          </div>
          <p className="text-sm text-muted-foreground md:text-ui">Deutsch</p>
        </div>
      </SettingsCard>
    </div>
  );
}
