"use client";

import Link from "next/link";
import { PanelLeftClose, PanelLeftOpen, Search, WifiOff } from "lucide-react";
import { useActivity } from "@/hooks/use-activity";
import { cn } from "@/components/ui/cn";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { PushToggle } from "@/components/push-toggle";
import { ActivityChip, ActivityRailButton } from "./activity";
import { openGatesLabel } from "./activity-format";
import { NAV_GROUPS, SETTINGS_ITEM, activeNavHref, type NavItem } from "./nav-config";
import { openCommandPalette } from "./shell-state";
import { modKeyLabel, useHostLabel, useIsApple } from "./use-client-info";

/**
 * How the desktop sidebar shows (DESIGN.md §5.1/§5.2):
 * - "full": 232px from lg, the 56px rail at md–lg;
 * - "auto": workspace page without an explicit choice: rail below 1600px;
 * - "rail": always the rail.
 * Visibility is pure CSS so the server render already has the right layout.
 */
export type SidebarMode = "full" | "auto" | "rail";

const VISIBILITY: Record<SidebarMode, { full: string; rail: string }> = {
  full: { full: "hidden lg:flex", rail: "flex lg:hidden" },
  auto: { full: "hidden min-[1600px]:flex", rail: "flex min-[1600px]:hidden" },
  rail: { full: "hidden", rail: "flex" },
};

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** The baton glyph on a primary tile. */
function BrandTile({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("grid shrink-0 place-items-center rounded-md bg-primary text-primary-foreground", className)}>
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
        <path d="M6.5 17.5 18 6" />
        <circle cx="6" cy="18" r="2.4" fill="currentColor" stroke="none" />
        <path d="M14.5 3.8c2.6.4 5.3 3.1 5.7 5.7" strokeWidth={1.8} opacity={0.7} />
      </svg>
    </span>
  );
}

interface SidebarProps {
  pathname: string;
  mode: SidebarMode;
  /** The full sidebar is showing right now (after hydration; false before). */
  fullVisible: boolean;
  /** Viewport ≥ md, i.e. the sidebar is visible at all (after hydration). */
  isDesktop: boolean;
  onToggle: () => void;
}

/** Assistent badge: warning count of open gates, else a brand dot while anything runs. */
function useAssistantMarker() {
  const { counts } = useActivity();
  if (counts.waiting > 0) return { kind: "waiting" as const, n: counts.waiting, sr: `, ${openGatesLabel(counts.waiting)}` };
  if (counts.running > 0) return { kind: "running" as const, n: counts.running, sr: ", läuft" };
  return null;
}

function ServerStatus({ compact = false }: { compact?: boolean }) {
  const { reachable } = useActivity();
  const host = useHostLabel() || "Server";
  const state = reachable ? "online" : "offline";
  if (compact) {
    return (
      <SimpleTooltip content={`${host} · ${state}`} side="right">
        <span role="img" aria-label={`${host} · ${state}`} tabIndex={0} className={cn("grid size-10 place-items-center rounded-md", focusRing)}>
          {/* Offline gets a shape cue too, not only a colour change. */}
          {reachable ? <span className="size-2 rounded-full bg-success" /> : <WifiOff className="size-4 text-warning" />}
        </span>
      </SimpleTooltip>
    );
  }
  return (
    // Changes are announced once by the shell's ConnectionAnnouncer.
    <p className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", reachable ? "bg-success" : "bg-warning")} />
      <span className="truncate">{host}</span>
      <span className={cn("shrink-0", reachable ? "text-subtle-foreground" : "font-medium text-warning")}>· {state}</span>
    </p>
  );
}

// ---------------------------------------------------------------------------
// Full sidebar (232px)
// ---------------------------------------------------------------------------

const navItemClass =
  "flex h-8 items-center gap-2.5 rounded-md px-2 text-ui text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground " +
  "aria-[current=page]:bg-accent aria-[current=page]:font-medium aria-[current=page]:text-foreground aria-[current=page]:[&>svg]:text-primary-text " +
  focusRing;

function FullNavLink({ item, active }: { item: NavItem; active: boolean }) {
  const marker = useAssistantMarker();
  const Icon = item.icon;
  const showMarker = item.href === "/assistant" && marker;
  return (
    <Link href={item.href} aria-current={active ? "page" : undefined} className={navItemClass}>
      <Icon aria-hidden className="size-4 shrink-0" />
      <span className="truncate">{item.label}</span>
      {showMarker ? (
        <>
          {marker.kind === "waiting" ? (
            <Badge aria-hidden variant="warning" className="ml-auto h-[18px] min-w-[18px] justify-center px-1.5 tabular-nums">
              {marker.n}
            </Badge>
          ) : (
            <span aria-hidden className="ml-auto mr-1 size-2 rounded-full bg-primary motion-safe:animate-breathe" />
          )}
          <span className="sr-only">{marker.sr}</span>
        </>
      ) : null}
    </Link>
  );
}

function FullSidebar({ pathname, className, showPush, onToggle }: { pathname: string; className: string; showPush: boolean; onToggle: () => void }) {
  const active = activeNavHref(pathname);
  const isApple = useIsApple();
  return (
    <div className={cn("w-[232px] min-h-0 flex-col", className)}>
      <div className="cm-drag flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <Link href="/" className={cn("flex min-w-0 items-center gap-2 rounded-md", focusRing)}>
          <BrandTile className="size-7" />
          <span className="truncate text-ui font-semibold tracking-tight">CodeMaestro</span>
        </Link>
        <IconButton
          size="icon-sm"
          aria-label="Seitenleiste einklappen"
          aria-keyshortcuts={isApple ? "Meta+B" : "Control+B"}
          tooltip={`Seitenleiste einklappen · ${modKeyLabel(isApple ?? false, "B")}`}
          onClick={onToggle}
          className="ml-auto"
        >
          <PanelLeftClose />
        </IconButton>
      </div>

      <div className="flex flex-col gap-1 p-2">
        <button
          type="button"
          onClick={openCommandPalette}
          aria-haspopup="dialog"
          aria-keyshortcuts={isApple ? "Meta+K" : "Control+K"}
          className={cn(
            "flex h-8 w-full items-center gap-1.5 rounded-md border border-border bg-background pl-2 pr-1.5 text-ui text-subtle-foreground transition-colors duration-150 hover:border-border-strong hover:text-muted-foreground",
            focusRing,
          )}
        >
          <Search aria-hidden className="size-4 shrink-0" />
          <span className="truncate">Suchen &amp; springen …</span>
          {isApple !== null ? (
            // Sans keeps "Strg K" narrow enough for the full placeholder.
            <Kbd aria-hidden className="ml-auto shrink-0 whitespace-nowrap font-sans">
              {modKeyLabel(isApple, "K")}
            </Kbd>
          ) : null}
        </button>
        <ActivityChip />
      </div>

      <nav aria-label="Hauptnavigation" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {NAV_GROUPS.map((group) => (
          <div key={group.id}>
            {group.label ? (
              <p id={`sb-group-${group.id}`} className="px-2 pb-1 pt-3 text-xs font-medium text-subtle-foreground">
                {group.label}
              </p>
            ) : null}
            <ul className="flex flex-col gap-0.5" aria-labelledby={group.label ? `sb-group-${group.id}` : undefined}>
              {group.items.map((item) => (
                <li key={item.href}>
                  <FullNavLink item={item} active={active === item.href} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="flex shrink-0 flex-col gap-1 border-t border-border p-2">
        <FullNavLink item={SETTINGS_ITEM} active={active === SETTINGS_ITEM.href} />
        <div className="flex min-h-8 items-center gap-1 pl-2">
          <ServerStatus />
          <span className="ml-auto flex shrink-0 items-center [&>button]:grid [&>button]:size-8 [&>button]:place-items-center">
            {showPush ? <PushToggle /> : null}
            <ThemeToggle size="icon" />
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rail (56px)
// ---------------------------------------------------------------------------

const railItemClass =
  "relative grid size-10 place-items-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground " +
  "aria-[current=page]:bg-accent aria-[current=page]:text-primary-text " +
  focusRing;

function TooltipLabel({ label, keys }: { label: string; keys?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      {label}
      {keys ? <span className="text-subtle-foreground">{keys}</span> : null}
    </span>
  );
}

function RailNavLink({ item, active }: { item: NavItem; active: boolean }) {
  const marker = useAssistantMarker();
  const Icon = item.icon;
  const showMarker = item.href === "/assistant" && marker;
  return (
    <SimpleTooltip content={<TooltipLabel label={item.label} keys={item.goKey ? `G ${item.goKey}` : undefined} />} side="right">
      <Link href={item.href} aria-current={active ? "page" : undefined} className={railItemClass}>
        <Icon aria-hidden className="size-[18px]" />
        <span className="sr-only">
          {item.label}
          {showMarker ? marker.sr : ""}
        </span>
        {showMarker ? (
          marker.kind === "waiting" ? (
            <span
              aria-hidden
              className="absolute right-0.5 top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-warning px-1 text-xs font-semibold leading-none tabular-nums text-background ring-2 ring-surface"
            >
              {marker.n}
            </span>
          ) : (
            <span aria-hidden className="absolute right-1.5 top-1.5 size-2 rounded-full bg-primary ring-2 ring-surface motion-safe:animate-breathe" />
          )
        ) : null}
      </Link>
    </SimpleTooltip>
  );
}

function RailSidebar({ pathname, className, showPush, onToggle }: { pathname: string; className: string; showPush: boolean; onToggle: () => void }) {
  const active = activeNavHref(pathname);
  const isApple = useIsApple();
  return (
    <div className={cn("w-14 min-h-0 flex-col items-center", className)}>
      <div className="cm-drag flex h-12 w-full shrink-0 items-center justify-center border-b border-border">
        <SimpleTooltip content="CodeMaestro · Start" side="right">
          <Link href="/" aria-label="CodeMaestro – Start" className={cn("rounded-md", focusRing)}>
            <BrandTile className="size-8" />
          </Link>
        </SimpleTooltip>
      </div>

      <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto py-2">
        <SimpleTooltip content={<TooltipLabel label="Suchen & springen" keys={modKeyLabel(isApple ?? false, "K")} />} side="right">
          <button
            type="button"
            onClick={openCommandPalette}
            aria-haspopup="dialog"
            aria-label="Suchen & springen"
            aria-keyshortcuts={isApple ? "Meta+K" : "Control+K"}
            className={railItemClass}
          >
            <Search aria-hidden className="size-[18px]" />
          </button>
        </SimpleTooltip>
        <ActivityRailButton />
        <nav aria-label="Hauptnavigation" className="flex flex-col items-center gap-1">
          {NAV_GROUPS.map((group, gi) => (
            <ul key={group.id} aria-label={group.label ?? undefined} className="flex flex-col items-center gap-1">
              {gi > 0 ? <li aria-hidden className="my-1 h-px w-6 bg-border" /> : null}
              {group.items.map((item) => (
                <li key={item.href}>
                  <RailNavLink item={item} active={active === item.href} />
                </li>
              ))}
            </ul>
          ))}
        </nav>
      </div>

      <div className="flex w-full shrink-0 flex-col items-center gap-1 border-t border-border py-2">
        <RailNavLink item={SETTINGS_ITEM} active={active === SETTINGS_ITEM.href} />
        {showPush ? (
          <span className="[&>button]:grid [&>button]:size-10 [&>button]:place-items-center">
            <PushToggle />
          </span>
        ) : null}
        <ThemeToggle size="icon-lg" />
        <ServerStatus compact />
        <IconButton
          size="icon-lg"
          aria-label="Seitenleiste ausklappen"
          aria-keyshortcuts={isApple ? "Meta+B" : "Control+B"}
          tooltip={`Seitenleiste ausklappen · ${modKeyLabel(isApple ?? false, "B")}`}
          onClick={onToggle}
          className="hidden lg:inline-flex"
        >
          <PanelLeftOpen />
        </IconButton>
      </div>
    </div>
  );
}

/** Desktop sidebar (≥ md): full 232px sidebar or 56px icon rail. */
export function Sidebar({ pathname, mode, fullVisible, isDesktop, onToggle }: SidebarProps) {
  const vis = VISIBILITY[mode];
  return (
    <aside aria-label="Seitenleiste" className="hidden shrink-0 border-r border-border bg-surface md:flex">
      <FullSidebar pathname={pathname} className={vis.full} showPush={isDesktop && fullVisible} onToggle={onToggle} />
      <RailSidebar pathname={pathname} className={vis.rail} showPush={isDesktop && !fullVisible} onToggle={onToggle} />
    </aside>
  );
}
