"use client";

import * as React from "react";
import { usePathname, useRouter, useSelectedLayoutSegment } from "next/navigation";
import { Search } from "lucide-react";
import { useUIStore, useUIStoreHydration } from "@/stores/ui-store";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useHotkeys, type HotkeyHandler } from "@/hooks/use-hotkeys";
import { cn } from "@/components/ui/cn";
import { AppBar } from "@/components/ui/app-bar";
import { IconButton } from "@/components/ui/button";
import { ActivityAppBarChip, ActivitySheet, ConnectionAnnouncer, OfflineAppBarChip } from "./activity";
import { CommandPalette } from "./command-palette";
import { GateBanner } from "./gate-banner";
import { GO_SHORTCUTS, isFullBleedRoute, isPromptRoute, titleForPath, workspaceRouteOf } from "./nav-config";
import { PromptsHubNav } from "./prompts-hub-nav";
import { useShellOverlays } from "./shell-state";
import { Sidebar, type SidebarMode } from "./sidebar";
import { ShortcutsHelp } from "./shortcuts-help";
import { MoreSheet, TabBar } from "./tab-bar";

// Installed desktop app in Window Controls Overlay mode (manifest
// display_override): a draggable strip as tall as the OS title bar area keeps
// the window controls off the pane headers; the sidebar brand row drags too.
// Buttons and links inside draggable areas stay clickable (no-drag).
const TITLEBAR_CSS = `.cm-titlebar { display: none; }
@media (display-mode: window-controls-overlay) {
  .cm-titlebar { display: block; height: env(titlebar-area-height, 0px); flex-shrink: 0;
    -webkit-app-region: drag; app-region: drag;
    padding-right: max(1rem, calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw) + 0.5rem)); }
  .cm-drag { -webkit-app-region: drag; app-region: drag; }
  .cm-titlebar button, .cm-titlebar a, .cm-drag button, .cm-drag a { -webkit-app-region: no-drag; app-region: no-drag; }
}`;

const LG_QUERY = "(min-width: 1024px)";
const WIDE_QUERY = "(min-width: 1600px)";
const DESKTOP_QUERY = "(min-width: 768px)";

/** Sidebar mode for a route from the persisted choices (see SidebarMode). */
function sidebarMode(route: string | null, sidebarOpen: boolean, prefs: Record<string, boolean>): SidebarMode {
  if (route) {
    const pref = prefs[route];
    if (pref === undefined) return sidebarOpen ? "auto" : "rail";
    return pref ? "full" : "rail";
  }
  return sidebarOpen ? "full" : "rail";
}

function ShellHotkeys({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  const router = useRouter();
  const paletteOpen = useShellOverlays((s) => s.palette);
  const setPalette = useShellOverlays((s) => s.setPalette);
  const setShortcuts = useShellOverlays((s) => s.setShortcuts);

  const bindings = React.useMemo(() => {
    const map: Record<string, HotkeyHandler> = {
      "mod+k": () => setPalette(true),
      "/": () => setPalette(true),
      "mod+b": onToggleSidebar,
      "?": () => setShortcuts(true),
    };
    for (const [key, href] of Object.entries(GO_SHORTCUTS)) map[`g ${key}`] = () => router.push(href);
    return map;
  }, [setPalette, setShortcuts, onToggleSidebar, router]);

  useHotkeys(bindings, { allowInInputs: ["mod+k"] });
  // ⌘K again closes the open palette (the dialog otherwise blocks shortcuts).
  useHotkeys({ "mod+k": () => setPalette(false) }, { enabled: paletteOpen, allowInDialogs: true, allowInInputs: ["mod+k"] });
  return null;
}

function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only z-[60] rounded-md bg-primary px-3 py-2 text-ui font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      Zum Inhalt springen
    </a>
  );
}

function Shell({ pathname, children }: { pathname: string; children: React.ReactNode }) {
  useUIStoreHydration();
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const sidebarPrefs = useUIStore((s) => s.sidebarPrefs);
  const appBarHidden = useUIStore((s) => s.appBarHidden);
  const tabBarHidden = useUIStore((s) => s.tabBarHidden);
  const setPalette = useShellOverlays((s) => s.setPalette);

  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const isLg = useMediaQuery(LG_QUERY);
  const isWide = useMediaQuery(WIDE_QUERY);

  const route = workspaceRouteOf(pathname);
  const mode = sidebarMode(route, sidebarOpen, sidebarPrefs);
  const fullVisible = mode === "full" ? isLg : mode === "auto" ? isWide : false;

  const toggleSidebar = React.useCallback(() => {
    // Below lg the sidebar is always the rail; nothing to toggle.
    if (!isLg) return;
    const ui = useUIStore.getState();
    if (route) ui.setSidebarPref(route, !fullVisible);
    else ui.setSidebarOpen(!fullVisible);
  }, [isLg, route, fullVisible]);

  const fullBleed = isFullBleedRoute(pathname);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background pl-safe pr-safe text-foreground">
      <style>{TITLEBAR_CSS}</style>
      <div className="cm-titlebar bg-surface" aria-hidden />
      <SkipLink />
      <div className="flex min-h-0 flex-1">
        <Sidebar pathname={pathname} mode={mode} fullVisible={fullVisible} isDesktop={isDesktop} onToggle={toggleSidebar} />
        <div className="flex min-w-0 flex-1 flex-col">
          {appBarHidden ? null : (
            <AppBar
              className="md:hidden"
              title={titleForPath(pathname)}
              actions={
                <>
                  <OfflineAppBarChip />
                  <ActivityAppBarChip />
                  <IconButton aria-label="Suchen & springen" aria-haspopup="dialog" onClick={() => setPalette(true)}>
                    <Search />
                  </IconButton>
                </>
              }
            />
          )}
          {/* The hub sub-nav belongs to the AppBar: a screen that brings its own
              bar (e.g. the phone prompt detail with its back link) hides both. */}
          {isPromptRoute(pathname) && !appBarHidden ? <PromptsHubNav pathname={pathname} /> : null}
          <main
            id="main"
            tabIndex={-1}
            className={cn(
              "min-h-0 flex-1 overflow-y-auto outline-none",
              // scroll-padding: Next scrolls a new page into view with
              // scrollIntoView(); keep the top gutter visible when it does.
              fullBleed ? "flex flex-col" : "scroll-pt-4 px-4 py-4 md:scroll-pt-6 md:px-6 md:py-6",
            )}
          >
            {children}
          </main>
          <GateBanner visible={!tabBarHidden} />
          <TabBar pathname={pathname} visible={!tabBarHidden} />
        </div>
      </div>
      <ConnectionAnnouncer />
      <ShellHotkeys onToggleSidebar={toggleSidebar} />
      <CommandPalette />
      <ShortcutsHelp />
      <ActivitySheet />
      <MoreSheet />
    </div>
  );
}

/**
 * The app frame (DESIGN.md §5): desktop sidebar/rail, mobile AppBar + TabBar
 * + GateBanner, the command palette, shortcut help and activity center. The
 * offline page renders bare (it is precached and served for failed loads).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  // The service worker serves the precached offline page under the URL that
  // failed, so detect it by the rendered route segment, not the pathname
  // (otherwise hydration would mismatch and wrap it in the full shell).
  const segment = useSelectedLayoutSegment();
  if (segment === "offline") return <main className="min-h-dvh bg-background text-foreground">{children}</main>;
  return <Shell pathname={pathname}>{children}</Shell>;
}
