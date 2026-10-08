"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Bell, ChevronRight, Cpu, Github, KeyRound, Network, RefreshCw, Send, SlidersHorizontal, Sparkles, type LucideIcon,
} from "lucide-react";
import { SETTINGS_SECTIONS } from "@/components/layout/nav-config";
import { OrchestraSummaryCard } from "@/components/orchestra";
import { PUSH_STATE_TEXT, pushUnavailable, usePushState, type PushSnapshot } from "@/components/push-toggle";
import { AppBar } from "@/components/ui/app-bar";
import { cn } from "@/components/ui/cn";
import { PageHeader } from "@/components/ui/page-header";
import { useShellChrome } from "@/hooks/use-shell-chrome";
import { APP_VERSION, AppSection } from "./app-section";
import { GeneralSection } from "./general-section";
import { GithubSettings } from "./github-settings";
import { ModelsSection } from "./models-section";
import { NotificationsSection } from "./notifications-section";
import { PiSettings } from "./pi-settings";
import { ProvidersSection } from "./providers-section";
import { loadSettingsHints, useSettingsHints, type SettingsHints } from "./settings-hints";
import { SectionHeader } from "./settings-ui";
import { TelegramSettings } from "./telegram-settings";
import { useProviderSetup, type ProviderSetup } from "./use-provider-setup";

export const SECTION_IDS = ["general", "notifications", "providers", "models", "pi", "orchestra", "github", "telegram", "app"] as const;
export type SectionId = (typeof SECTION_IDS)[number];

const ICONS: Record<SectionId, LucideIcon> = {
  general: SlidersHorizontal,
  notifications: Bell,
  providers: KeyRound,
  models: Sparkles,
  pi: Cpu,
  orchestra: Network,
  github: Github,
  telegram: Send,
  app: RefreshCw,
};

const LABELS: Record<string, string> = Object.fromEntries(SETTINGS_SECTIONS.map((s) => [s.id, s.label]));

function labelOf(id: SectionId): string {
  return LABELS[id] ?? id;
}

/** `?section=<id>` → a known section id, else null. */
export function parseSection(value: string | null | undefined): SectionId | null {
  return (SECTION_IDS as readonly string[]).includes(value ?? "") ? (value as SectionId) : null;
}

type DotTone = "success" | "warning" | "danger" | "neutral";

interface Hint {
  /** Short visible text („4/14", „aktiv", „an"). */
  text?: string;
  textTone?: "success" | "muted";
  dot?: DotTone;
  /** What the hint means, for screen readers. */
  sr: string;
}

const DOT_CLASS: Record<DotTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  neutral: "bg-subtle-foreground",
};

function sectionHints(setup: ProviderSetup, hints: SettingsHints, push: PushSnapshot): Partial<Record<SectionId, Hint>> {
  const out: Partial<Record<SectionId, Hint>> = {};
  if (push.status === "on") out.notifications = { text: "an", sr: "Push an" };
  else if (push.status !== "checking" && push.status !== "busy") {
    out.notifications = { text: "aus", sr: pushUnavailable(push.status) ? `Push aus: ${PUSH_STATE_TEXT[push.status]}` : "Push aus" };
  }

  const { configured, total } = setup.summary;
  out.providers = { text: `${configured}/${total}`, sr: `${configured} von ${total} eingerichtet` };

  if (hints.pi) {
    out.pi = hints.pi.installed
      ? hints.pi.error
        ? { dot: "warning", sr: "installiert, Synchronisierung mit Fehler" }
        : { dot: "success", sr: "installiert" }
      : { dot: "neutral", sr: "nicht installiert" };
  }
  if (hints.github) {
    out.github = hints.github.connected
      ? hints.github.tokenReadable
        ? { dot: "success", sr: "verbunden" }
        : { dot: "danger", sr: "Token ungültig" }
      : { dot: "warning", sr: "nicht verbunden" };
  }
  if (hints.telegram?.running) out.telegram = { text: "aktiv", textTone: "success", sr: "aktiv" };
  out.app = { text: APP_VERSION, sr: `Version ${APP_VERSION}` };
  return out;
}

function HintView({ hint }: { hint?: Hint }) {
  if (!hint) return null;
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1.5">
      {hint.text ? (
        <span
          aria-hidden
          className={cn(
            "font-mono text-xs tabular-nums",
            hint.textTone === "success" ? "font-sans font-medium text-success" : "text-subtle-foreground",
          )}
        >
          {hint.text}
        </span>
      ) : null}
      {hint.dot ? <span aria-hidden className={cn("size-2 rounded-full", DOT_CLASS[hint.dot])} /> : null}
      <span className="sr-only">({hint.sr})</span>
    </span>
  );
}

function SectionNav({ current, hints }: { current: SectionId; hints: Partial<Record<SectionId, Hint>> }) {
  return (
    <nav aria-label="Bereiche der Einstellungen" className="hidden md:block">
      <ul className="sticky top-0 flex flex-col gap-0.5">
        {SECTION_IDS.map((id) => {
          const Icon = ICONS[id];
          const active = id === current;
          return (
            <li key={id}>
              <Link
                href={`/settings?section=${id}`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-8 items-center gap-2.5 rounded-md px-2 text-ui text-muted-foreground transition-colors duration-150",
                  "hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  "aria-[current=page]:bg-accent aria-[current=page]:font-medium aria-[current=page]:text-foreground [&[aria-current=page]>svg]:text-primary-text",
                )}
              >
                <Icon aria-hidden className="size-4 shrink-0" />
                <span className="min-w-0 truncate">{labelOf(id)}</span>
                <HintView hint={hints[id]} />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function MobileIndex({ hints }: { hints: Partial<Record<SectionId, Hint>> }) {
  return (
    <nav aria-label="Bereiche der Einstellungen" className="md:hidden">
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card shadow-xs">
        {SECTION_IDS.map((id) => {
          const Icon = ICONS[id];
          return (
            <li key={id}>
              <Link
                href={`/settings?section=${id}`}
                className="flex min-h-12 items-center gap-3 px-4 py-2 text-base text-foreground hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              >
                <Icon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{labelOf(id)}</span>
                <HintView hint={hints[id]} />
                <ChevronRight aria-hidden className="size-4 shrink-0 text-subtle-foreground" />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function OrchestraSection() {
  return (
    <div>
      <SectionHeader
        title="Orchester"
        description="Welches Modell spielt welche Rolle? Die Besetzung gilt für alle Orchester-Läufe; bearbeiten kannst du sie im Organigramm."
      />
      <OrchestraSummaryCard variant="settings" />
    </div>
  );
}

function SectionContent({ id, setup }: { id: SectionId; setup: ProviderSetup }) {
  switch (id) {
    case "general":
      return <GeneralSection />;
    case "notifications":
      return <NotificationsSection />;
    case "providers":
      return <ProvidersSection setup={setup} />;
    case "models":
      return <ModelsSection setup={setup} />;
    case "pi":
      return <PiSettings />;
    case "orchestra":
      return <OrchestraSection />;
    case "github":
      return <GithubSettings />;
    case "telegram":
      return <TelegramSettings />;
    case "app":
      return <AppSection />;
  }
}

/**
 * /settings (DESIGN.md §6.4). `?section=<id>` selects a section.
 * Desktop: sticky section nav with status hints + one section (default
 * Allgemein). Phone: an index list; a section opens as its own screen with an
 * AppBar back to the index.
 */
export function SettingsView() {
  const params = useSearchParams();
  const section = parseSection(params.get("section"));
  const current: SectionId = section ?? "general";
  const setup = useProviderSetup({ withModels: current === "models" });
  const store = useSettingsHints();
  const push = usePushState();
  const hints = sectionHints(setup, store, push);

  useEffect(() => {
    loadSettingsHints();
  }, []);

  // Phone: a section is its own screen with its own AppBar (back to the index).
  useShellChrome({ appBar: section === null });

  return (
    <div className="mx-auto w-full max-w-[1000px]">
      {section ? (
        <AppBar
          // main has a 16px top padding; -top-4 pins the bar to the very top while scrolling.
          className="-top-4 -mx-4 -mt-4 mb-4 md:hidden"
          back={{ href: "/settings", label: "Einstellungen" }}
          title={labelOf(section)}
        />
      ) : null}
      <PageHeader title="Einstellungen" className="max-md:pb-0" />
      <div className="max-md:mt-0 md:grid md:grid-cols-[200px_minmax(0,1fr)] md:gap-6 lg:grid-cols-[220px_minmax(0,720px)] lg:gap-10">
        <SectionNav current={current} hints={hints} />
        {section ? null : <MobileIndex hints={hints} />}
        <div className={cn("min-w-0 pb-8", section ? null : "hidden md:block")}>
          <SectionContent key={current} id={current} setup={setup} />
        </div>
      </div>
    </div>
  );
}
