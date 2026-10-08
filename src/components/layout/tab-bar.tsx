"use client";

import * as React from "react";
import Link from "next/link";
import { BookOpen, ChevronRight, Settings } from "lucide-react";
import { useActivity } from "@/hooks/use-activity";
import { useBottomChrome } from "@/components/ui/toaster";
import { Sheet, SheetBody, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ThemeSegmented } from "@/components/theme/theme-toggle";
import { PushToggle } from "@/components/push-toggle";
import { NAV_LABEL } from "@/lib/labels";
import { version as APP_VERSION } from "../../../package.json";
import { openGatesLabel } from "./activity-format";
import { TAB_ITEMS, activeTab, type TabItem } from "./nav-config";
import { useShellOverlays } from "./shell-state";

const tabClass =
  "relative flex h-full w-full flex-col items-center justify-center gap-0.5 text-xs font-medium text-muted-foreground " +
  "transition-colors duration-150 hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring " +
  "aria-[current=page]:text-primary-text";

function ActiveIndicator({ active }: { active: boolean }) {
  if (!active) return null;
  return <span aria-hidden className="absolute inset-x-5 top-0 h-0.5 rounded-b-full bg-primary-text" />;
}

function TabIcon({ tab, waiting, running }: { tab: TabItem; waiting: number; running: number }) {
  const Icon = tab.icon;
  return (
    <span className="relative">
      <Icon aria-hidden className="size-6" strokeWidth={1.75} />
      {tab.id === "assistant" && waiting > 0 ? (
        <span
          aria-hidden
          className="absolute -right-2.5 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-warning px-1 text-xs font-semibold leading-none tabular-nums text-background ring-2 ring-surface"
        >
          {waiting > 99 ? "99+" : waiting}
        </span>
      ) : tab.id === "assistant" && running > 0 ? (
        <span
          aria-hidden
          className="absolute -right-1 -top-0.5 size-2.5 rounded-full bg-primary ring-2 ring-surface motion-safe:animate-breathe"
        />
      ) : null}
    </span>
  );
}

/**
 * Mobile bottom navigation (DESIGN.md §5.3): Start · Assistent · Orchester ·
 * Prompts · Mehr. 56px + safe area; reports its height to --cm-bottom-chrome.
 */
export function TabBar({ pathname, visible }: { pathname: string; visible: boolean }) {
  const ref = React.useRef<HTMLElement>(null);
  useBottomChrome(ref, visible);
  const { counts } = useActivity();
  const more = useShellOverlays((s) => s.more);
  const setMore = useShellOverlays((s) => s.setMore);
  const active = activeTab(pathname);

  if (!visible) return null;
  return (
    <nav
      ref={ref}
      aria-label="Hauptnavigation"
      className="relative z-30 shrink-0 border-t border-border bg-surface pb-safe md:hidden"
    >
      <ul className="grid h-14 grid-cols-5">
        {TAB_ITEMS.map((tab) => {
          const isActive = active === tab.id;
          const extra =
            tab.id === "assistant" && counts.waiting > 0
              ? `, ${openGatesLabel(counts.waiting)}`
              : tab.id === "assistant" && counts.running > 0
                ? ", läuft"
                : "";
          const content = (
            <>
              <ActiveIndicator active={isActive} />
              <TabIcon tab={tab} waiting={counts.waiting} running={counts.running} />
              <span>{tab.label}</span>
              {extra ? <span className="sr-only">{extra}</span> : null}
            </>
          );
          return (
            <li key={tab.id} className="min-w-0">
              {tab.href ? (
                <Link href={tab.href} aria-current={isActive ? "page" : undefined} className={tabClass}>
                  {content}
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => setMore(true)}
                  aria-haspopup="dialog"
                  aria-expanded={more}
                  aria-current={isActive ? "page" : undefined}
                  className={tabClass}
                >
                  {content}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

const rowClass =
  "flex min-h-12 items-center gap-3 rounded-lg px-3 text-base hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** „Mehr" bottom sheet: Wissensbasis · Einstellungen · Design · Push · App-Version. */
export function MoreSheet() {
  const open = useShellOverlays((s) => s.more);
  const setMore = useShellOverlays((s) => s.setMore);
  return (
    <Sheet open={open} onOpenChange={setMore}>
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>Mehr</SheetTitle>
          <SheetDescription className="sr-only">Weitere Bereiche und Einstellungen dieses Geräts</SheetDescription>
        </SheetHeader>
        <SheetBody className="px-2">
          <ul className="flex flex-col">
            {[
              { href: "/knowledge", icon: BookOpen },
              { href: "/settings", icon: Settings },
            ].map(({ href, icon: Icon }) => (
              <li key={href}>
                <SheetClose asChild>
                  <Link href={href} className={rowClass}>
                    <Icon aria-hidden className="size-5 text-muted-foreground" />
                    <span className="flex-1">{NAV_LABEL[href]}</span>
                    <ChevronRight aria-hidden className="size-4 text-subtle-foreground" />
                  </Link>
                </SheetClose>
              </li>
            ))}
          </ul>
          <div className="mx-3 my-2 h-px bg-border" />
          <div className="flex flex-col gap-1 px-3">
            <div className="flex flex-col gap-2 py-2">
              <span className="text-sm font-medium">Design</span>
              <ThemeSegmented stretch className="w-full" />
            </div>
            <div className="flex min-h-12 items-center justify-between gap-3">
              <span className="text-sm font-medium">Push-Benachrichtigungen</span>
              <span className="grid min-h-10 min-w-10 place-items-center [&>button]:grid [&>button]:size-10 [&>button]:place-items-center">
                <PushToggle />
              </span>
            </div>
            <div className="flex min-h-12 items-center justify-between gap-3">
              <span className="text-sm font-medium">App-Version</span>
              <span className="font-mono text-ui tabular-nums text-muted-foreground">{APP_VERSION}</span>
            </div>
          </div>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
