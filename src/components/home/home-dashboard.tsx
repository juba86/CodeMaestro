"use client";

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { Coffee } from "lucide-react";
import { OrchestraSummaryCard } from "@/components/orchestra";
import { usePushState } from "@/components/push-toggle";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useActivity } from "@/hooks/use-activity";
import { useNow } from "@/hooks/use-now";
import { formatCost, greeting } from "@/lib/format";
import { RunningWidget, WaitingWidget } from "./activity-widgets";
import { isFirstRun, newSessionHref, usageSince, type HomeSession } from "./home-logic";
import { QuickStart } from "./quick-start";
import { RecentWidget } from "./recent-widgets";
import { SetupChecklist, type SetupStep } from "./setup-checklist";
import { StatusList, StatusStrip, type StatusSources } from "./status-overview";
import {
  loadGithub, loadKnowledge, loadPrompts, loadProviders, loadSessions, loadTelegram, useResource, type Resource,
} from "./use-resource";
import { Widget, WidgetError } from "./widget";

const noop = () => () => {};

/** Installed as an app (standalone / window-controls-overlay); false on the server. */
function useStandalone(): boolean {
  return useSyncExternalStore(
    noop,
    () =>
      window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: window-controls-overlay)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
    () => false,
  );
}

function UsageWidget({ sessions, className }: { sessions: Resource<HomeSession[]>; className?: string }) {
  const now = useNow(60_000);
  let body: ReactNode;
  if (sessions.error && !sessions.data) {
    body = <WidgetError title="Nutzung konnte nicht geladen werden" message={sessions.error} onRetry={sessions.retry} loading={sessions.loading} />;
  } else if (!sessions.data || now === 0) {
    body = (
      <Card className="flex gap-6 p-4" aria-busy>
        <span className="sr-only" role="status">
          Nutzung wird geladen …
        </span>
        <div className="space-y-1.5">
          <Skeleton className="h-7 w-10" />
          <Skeleton className="h-3 w-24" />
        </div>
      </Card>
    );
  } else {
    const usage = usageSince(sessions.data, now, 7);
    const cost = formatCost(usage.costUsd);
    body = (
      <Card asChild className="p-4">
        <dl className="flex flex-wrap gap-x-8 gap-y-3">
          <div className="flex flex-col-reverse">
            <dt className="text-xs text-muted-foreground">{usage.sessions === 1 ? "Session bearbeitet" : "Sessions bearbeitet"}</dt>
            <dd className="text-2xl font-semibold tabular-nums text-foreground">{usage.sessions}</dd>
          </div>
          {cost ? (
            <div className="flex flex-col-reverse">
              <dt className="text-xs text-muted-foreground">Kosten dieser Sessions</dt>
              <dd className="text-2xl font-semibold tabular-nums text-foreground">{cost}</dd>
            </div>
          ) : null}
        </dl>
      </Card>
    );
  }
  return (
    <Widget title="Nutzung (7 Tage)" className={className}>
      {body}
    </Widget>
  );
}

function Greeting() {
  const now = useNow(60_000);
  return (
    <h1 className="sr-only md:not-sr-only md:text-2xl md:font-semibold md:tracking-[-0.015em] md:text-foreground">
      {now > 0 ? greeting(new Date(now)) : "Start"}
    </h1>
  );
}

/**
 * The Start dashboard (DESIGN.md §6.1). Every widget loads and fails on its
 * own; the page never goes blank.
 */
export function HomeDashboard() {
  const activity = useActivity();
  const sessions = useResource(loadSessions);
  const prompts = useResource(loadPrompts);
  const providers = useResource(loadProviders);
  const github = useResource(loadGithub);
  const telegram = useResource(loadTelegram);
  const knowledge = useResource(loadKnowledge);
  const push = usePushState();
  const standalone = useStandalone();

  // A run started or ended: reload „Zuletzt" and „Nutzung" quietly (the old
  // rows stay on screen while loading), so a finished session shows its result.
  const runKey = activity.runs.map((r) => r.sessionId).sort().join(",");
  const lastRunKey = useRef<string | null>(null);
  const retrySessions = sessions.retry;
  useEffect(() => {
    if (activity.loading) return;
    if (lastRunKey.current !== null && lastRunKey.current !== runKey) retrySessions();
    lastRunKey.current = runKey;
  }, [runKey, activity.loading, retrySessions]);

  const sources: StatusSources = {
    reachable: activity.reachable,
    activityLoading: activity.loading,
    providers,
    telegram,
    github,
    knowledge,
    push,
  };

  const firstRun = sessions.data !== null && providers.data !== null && isFirstRun(sessions.data.length, providers.data.configured);
  const steps: SetupStep[] = [
    {
      key: "provider",
      label: "Provider verbinden",
      hint: "Claude, Gemini oder ein lokales Modell für Builder und Playground",
      href: "/settings?section=providers",
      done: (providers.data?.configured ?? 0) > 0,
    },
    {
      key: "session",
      label: "Erste Session starten",
      hint: "Einen Coding-Agenten in einem Projektordner arbeiten lassen",
      href: newSessionHref(),
      done: (sessions.data?.length ?? 0) > 0,
    },
    {
      key: "github",
      label: "GitHub verbinden",
      hint: "Damit Agenten nach deiner Freigabe pushen können",
      href: "/settings?section=github",
      done: Boolean(github.data?.connected),
    },
    {
      key: "install",
      label: "App installieren",
      hint: "Vollbild und Push-Benachrichtigungen auf dem Handy",
      href: "/settings?section=app",
      done: standalone,
    },
    {
      key: "telegram",
      label: "Telegram",
      hint: "Steuern, wenn du nicht im Tailscale bist",
      href: "/settings?section=telegram",
      done: Boolean(telegram.data?.enabled),
      optional: true,
    },
  ];

  const idle = !activity.loading && activity.reachable && activity.runs.length === 0 && activity.pending.length === 0;

  return (
    <div className="mx-auto w-full max-w-[1200px]">
      <header className="mb-4 flex flex-col gap-3 md:mb-6">
        <Greeting />
        <StatusStrip sources={sources} className="hidden md:flex" />
      </header>

      {/* Phone: one column in the §6.1 order (columns become `contents`, `order` sorts). */}
      <div className="flex flex-col gap-6 md:grid md:grid-cols-12 md:items-start">
        <div className="contents md:col-span-8 md:flex md:flex-col md:gap-6">
          {!activity.reachable ? (
            <Callout
              variant="warning"
              className="order-1"
              title="Server nicht erreichbar"
              action={
                <Button variant="outline" onClick={() => void activity.refresh()}>
                  Erneut versuchen
                </Button>
              }
            >
              Laufende Sessions arbeiten auf dem Server weiter; die Anzeige kann veraltet sein.
            </Callout>
          ) : null}
          {firstRun ? <SetupChecklist steps={steps} className="order-1" /> : null}
          <WaitingWidget pending={activity.pending} className="order-1" />
          <RunningWidget runs={activity.runs} pending={activity.pending} className="order-2" />
          {idle && !firstRun ? (
            <p className="order-2 flex items-center gap-2 rounded-lg border border-dashed border-border-strong px-4 py-3 text-sm text-muted-foreground md:text-ui">
              <Coffee aria-hidden className="size-4 shrink-0 text-subtle-foreground" />
              Gerade läuft nichts.
            </p>
          ) : null}
          {firstRun ? null : (
            <RecentWidget sessions={sessions} prompts={prompts} runs={activity.runs} pending={activity.pending} className="order-4" />
          )}
        </div>

        <div className="contents md:col-span-4 md:flex md:flex-col md:gap-6">
          <QuickStart sessions={sessions.data} className="order-3" />
          <OrchestraSummaryCard variant="home" className="order-5" />
          <UsageWidget sessions={sessions} className="order-6" />
        </div>

        <StatusList sources={sources} className="order-7 md:hidden" />
      </div>
    </div>
  );
}
