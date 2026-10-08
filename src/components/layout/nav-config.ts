// Navigation model of the app shell (DESIGN.md §5.2, §5.3, §8.2): sidebar
// items and groups, the mobile tab bar mapping, route classes (prompt hub,
// full-bleed workspaces) and page titles. Route logic is pure (unit-tested).

import {
  BookOpen,
  Ellipsis,
  FlaskConical,
  Hammer,
  House,
  LayoutTemplate,
  Library,
  Network,
  Settings,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";
import { NAV_LABEL } from "@/lib/labels";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Second key of the "G then …" shortcut, upper-case for display (e.g. "A"). */
  goKey?: string;
}

export interface NavGroup {
  id: "main" | "prompts" | "context";
  /** Visible group label; the first group has none. */
  label: string | null;
  items: NavItem[];
}

const item = (href: string, icon: LucideIcon, goKey?: string): NavItem => ({
  href,
  label: NAV_LABEL[href],
  icon,
  goKey,
});

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "main",
    label: null,
    items: [item("/", House, "H"), item("/assistant", SquareTerminal, "A"), item("/orchestra", Network, "O")],
  },
  {
    id: "prompts",
    label: "Prompts",
    items: [
      item("/builder", Hammer, "B"),
      item("/library", Library, "L"),
      item("/templates", LayoutTemplate),
      item("/playground", FlaskConical),
    ],
  },
  { id: "context", label: "Kontext", items: [item("/knowledge", BookOpen)] },
];

/** Sidebar footer link. */
export const SETTINGS_ITEM: NavItem = item("/settings", Settings, "S");

/** Every page, in sidebar order (palette "Springen"). */
export const ALL_NAV_ITEMS: NavItem[] = [...NAV_GROUPS.flatMap((g) => g.items), SETTINGS_ITEM];

/** "G then <key>" navigation (§5.6). Keys are lower-case. */
export const GO_SHORTCUTS: Record<string, string> = Object.fromEntries(
  ALL_NAV_ITEMS.filter((i) => i.goKey).map((i) => [i.goKey!.toLowerCase(), i.href]),
);

/** The four prompt pages that share the "Prompts" tab and the hub nav (§5.3). */
export const PROMPT_ROUTES = ["/builder", "/library", "/templates", "/playground"] as const;

/** Prompts hub nav order (mobile): Bibliothek · Builder · Vorlagen · Playground. */
export const PROMPT_HUB_ITEMS: { href: string; label: string }[] = [
  { href: "/library", label: NAV_LABEL["/library"] },
  { href: "/builder", label: NAV_LABEL["/builder"] },
  { href: "/templates", label: NAV_LABEL["/templates"] },
  { href: "/playground", label: NAV_LABEL["/playground"] },
];

/** Pages that manage their own scrolling and padding (no main padding). */
export const FULL_BLEED_ROUTES = ["/assistant", "/orchestra"] as const;

/** Workspace pages: the sidebar defaults to the rail below 1600px (§5.1). */
export const WORKSPACE_ROUTES: readonly string[] = FULL_BLEED_ROUTES;

/** Settings sections (`/settings?section=<id>`, §6.4). */
export const SETTINGS_SECTIONS: { id: string; label: string }[] = [
  { id: "general", label: "Allgemein" },
  { id: "notifications", label: "Benachrichtigungen" },
  { id: "providers", label: "Provider" },
  { id: "models", label: "Standardmodell" },
  { id: "pi", label: "Lokale Agenten (pi)" },
  { id: "orchestra", label: "Orchester" },
  { id: "github", label: "GitHub" },
  { id: "telegram", label: "Telegram" },
  { id: "app", label: "App & Updates" },
];

/** `pathname` is `href` or one of its sub-pages ("/" matches only itself). */
export function matchesRoute(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The nav href that is active for `pathname`, or null. */
export function activeNavHref(pathname: string): string | null {
  return ALL_NAV_ITEMS.find((i) => matchesRoute(pathname, i.href))?.href ?? null;
}

export function isPromptRoute(pathname: string): boolean {
  return PROMPT_ROUTES.some((r) => matchesRoute(pathname, r));
}

export function isFullBleedRoute(pathname: string): boolean {
  return FULL_BLEED_ROUTES.some((r) => matchesRoute(pathname, r));
}

/** The workspace route `pathname` belongs to (key of `sidebarPrefs`), or null. */
export function workspaceRouteOf(pathname: string): string | null {
  return WORKSPACE_ROUTES.find((r) => matchesRoute(pathname, r)) ?? null;
}

/** Mobile AppBar title for a route; unknown pages fall back to the app name. */
export function titleForPath(pathname: string): string {
  const href = activeNavHref(pathname);
  return href ? NAV_LABEL[href] : "CodeMaestro";
}

// ---------------------------------------------------------------------------
// Mobile tab bar (§5.3): Start · Assistent · Orchester · Prompts · Mehr
// ---------------------------------------------------------------------------

export type TabId = "start" | "assistant" | "orchestra" | "prompts" | "more";

export interface TabItem {
  id: TabId;
  label: string;
  icon: LucideIcon;
  /** Link target; "Mehr" has none (it opens a sheet). */
  href?: string;
}

export const TAB_ITEMS: TabItem[] = [
  { id: "start", label: NAV_LABEL["/"], icon: House, href: "/" },
  { id: "assistant", label: NAV_LABEL["/assistant"], icon: SquareTerminal, href: "/assistant" },
  { id: "orchestra", label: NAV_LABEL["/orchestra"], icon: Network, href: "/orchestra" },
  { id: "prompts", label: NAV_LABEL.prompts, icon: Library, href: "/library" },
  { id: "more", label: NAV_LABEL.more, icon: Ellipsis },
];

/** Pages reached through the "Mehr" sheet; the Mehr tab is active on them. */
export const MORE_ROUTES = ["/knowledge", "/settings"] as const;

/** Which tab is active for `pathname` (null on pages outside the tab model). */
export function activeTab(pathname: string): TabId | null {
  if (matchesRoute(pathname, "/")) return "start";
  if (matchesRoute(pathname, "/assistant")) return "assistant";
  if (matchesRoute(pathname, "/orchestra")) return "orchestra";
  if (isPromptRoute(pathname)) return "prompts";
  if (MORE_ROUTES.some((r) => matchesRoute(pathname, r))) return "more";
  return null;
}
