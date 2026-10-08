"use client";

import Link from "next/link";
import { Bell, BookOpen, ChevronRight, Github, KeyRound, RefreshCw, Send, Server, type LucideIcon } from "lucide-react";
import { useHostLabel } from "@/components/layout/use-client-info";
import { pushUnavailable, type PushSnapshot } from "@/components/push-toggle";
import type { ProviderSetupSummary } from "@/components/settings/provider-status";
import { badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Skeleton } from "@/components/ui/skeleton";
import type { HomeGithub, HomeTelegram, Resource } from "./use-resource";

type Tone = "success" | "warning" | "danger" | "neutral";

interface StatusItem {
  key: string;
  icon: LucideIcon;
  href: string;
  /** Mobile row: name + value; desktop chip: `chip`. */
  name: string;
  value: string;
  chip: string;
  tone: Tone;
  loading?: boolean;
  failed?: boolean;
}

const DOT: Record<Tone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  neutral: "bg-subtle-foreground",
};

const VALUE_TEXT: Record<Tone, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  neutral: "text-muted-foreground",
};

export interface StatusSources {
  reachable: boolean;
  activityLoading: boolean;
  providers: Resource<ProviderSetupSummary>;
  telegram: Resource<HomeTelegram>;
  github: Resource<HomeGithub>;
  knowledge: Resource<{ docs: number }>;
  push: PushSnapshot;
}

function useStatusItems(s: StatusSources): StatusItem[] {
  const host = useHostLabel();
  const items: StatusItem[] = [];

  items.push({
    key: "server",
    icon: Server,
    href: "/settings?section=app",
    name: host || "Server",
    value: s.reachable ? "online" : "offline",
    chip: `${host || "Server"} · ${s.reachable ? "online" : "offline"}`,
    tone: s.reachable ? "success" : "warning",
    loading: s.activityLoading,
  });

  const p = s.providers.data;
  items.push({
    key: "providers",
    icon: KeyRound,
    href: "/settings?section=providers",
    name: "Provider",
    value: p ? `${p.configured} von ${p.total} eingerichtet` : "Status unbekannt",
    chip: p ? `Provider ${p.configured}/${p.total}` : "Provider · unbekannt",
    tone: p ? (p.configured === 0 ? "warning" : "neutral") : "neutral",
    loading: s.providers.loading && !p,
    failed: Boolean(s.providers.error && !p),
  });

  const t = s.telegram.data;
  const tValue = t ? (t.running ? `aktiv${t.botUsername ? ` · @${t.botUsername}` : ""}` : t.enabled ? "gestoppt" : "aus") : "Status unbekannt";
  items.push({
    key: "telegram",
    icon: Send,
    href: "/settings?section=telegram",
    name: "Telegram",
    value: tValue,
    chip: t ? `Telegram ${t.running ? "aktiv" : t.enabled ? "gestoppt" : "aus"}` : "Telegram · unbekannt",
    tone: t ? (t.running ? "success" : t.enabled ? "warning" : "neutral") : "neutral",
    loading: s.telegram.loading && !t,
    failed: Boolean(s.telegram.error && !t),
  });

  const g = s.github.data;
  const gValue = g ? (g.connected ? (g.tokenReadable ? `verbunden${g.login ? ` · @${g.login}` : ""}` : "Token ungültig") : "nicht verbunden") : "Status unbekannt";
  items.push({
    key: "github",
    icon: Github,
    href: "/settings?section=github",
    name: "GitHub",
    value: gValue,
    chip: g ? (g.connected ? (g.tokenReadable ? "GitHub verbunden" : "GitHub-Token ungültig") : "GitHub nicht verbunden") : "GitHub · unbekannt",
    tone: g ? (g.connected ? (g.tokenReadable ? "success" : "danger") : "warning") : "neutral",
    loading: s.github.loading && !g,
    failed: Boolean(s.github.error && !g),
  });

  const k = s.knowledge.data;
  items.push({
    key: "knowledge",
    icon: BookOpen,
    href: "/knowledge",
    name: "Wissensbasis",
    value: k ? (k.docs > 0 ? `bereit · ${k.docs} ${k.docs === 1 ? "Dokument" : "Dokumente"}` : "leer") : "Status unbekannt",
    chip: k ? (k.docs > 0 ? "Wissensbasis bereit" : "Wissensbasis leer") : "Wissensbasis · unbekannt",
    tone: k && k.docs > 0 ? "success" : "neutral",
    loading: s.knowledge.loading && !k,
    failed: Boolean(s.knowledge.error && !k),
  });

  const ps = s.push.status;
  const pushValue = ps === "on" ? "an" : ps === "denied" ? "blockiert" : pushUnavailable(ps) ? "nicht verfügbar" : "aus";
  items.push({
    key: "push",
    icon: Bell,
    href: "/settings?section=notifications",
    name: "Push",
    value: pushValue,
    chip: `Push ${pushValue}`,
    tone: ps === "on" ? "success" : ps === "denied" ? "warning" : "neutral",
    loading: ps === "checking",
  });

  return items;
}

function retryFailed(s: StatusSources) {
  for (const r of [s.providers, s.telegram, s.github, s.knowledge] as Resource<unknown>[]) {
    if (r.error && !r.data) r.retry();
  }
}

/** Desktop status strip: one chip per subsystem, each linking to its settings. */
export function StatusStrip({ sources, className }: { sources: StatusSources; className?: string }) {
  const items = useStatusItems(sources);
  const anyFailed = items.some((i) => i.failed);
  return (
    <ul aria-label="Status" className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {items.map((i) =>
        i.loading ? (
          <li key={i.key}>
            <Skeleton className="h-6 w-28 rounded-full" />
          </li>
        ) : (
          <li key={i.key}>
            <Link
              href={i.href}
              className={cn(
                badgeVariants({ variant: i.tone === "warning" ? "warning" : i.tone === "danger" ? "danger" : "outline", size: "md" }),
                "bg-card transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              )}
            >
              <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", DOT[i.tone])} />
              {i.chip}
            </Link>
          </li>
        ),
      )}
      {anyFailed ? (
        <li>
          <Button variant="ghost" size="sm" onClick={() => retryFailed(sources)}>
            <RefreshCw />
            Erneut prüfen
          </Button>
        </li>
      ) : null}
    </ul>
  );
}

/** Phone: the same status as rows (≥48px), at the end of the page. */
export function StatusList({ sources, className }: { sources: StatusSources; className?: string }) {
  const items = useStatusItems(sources);
  const anyFailed = items.some((i) => i.failed);
  return (
    <section aria-labelledby="home-status" className={className}>
      <div className="mb-2 flex min-h-7 items-center">
        <h2 id="home-status" className="text-sm font-semibold text-foreground">
          Status
        </h2>
        {anyFailed ? (
          <Button variant="ghost" className="ml-auto" onClick={() => retryFailed(sources)}>
            <RefreshCw />
            Erneut prüfen
          </Button>
        ) : null}
      </div>
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card shadow-xs">
        {items.map((i) => {
          const Icon = i.icon;
          return (
            <li key={i.key}>
              <Link
                href={i.href}
                className="flex min-h-12 items-center gap-3 px-4 py-2 hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              >
                <Icon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
                <span className="shrink-0 text-base text-foreground">{i.name}</span>
                {i.loading ? (
                  <Skeleton className="ml-auto h-4 w-20" />
                ) : (
                  <span className={cn("ml-auto flex min-w-0 items-center gap-1.5 text-sm", VALUE_TEXT[i.tone])}>
                    <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", DOT[i.tone])} />
                    <span className="truncate">{i.value}</span>
                  </span>
                )}
                <ChevronRight aria-hidden className="size-4 shrink-0 text-subtle-foreground" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
