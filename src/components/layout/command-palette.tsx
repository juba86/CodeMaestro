"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Bell, CornerDownLeft, Keyboard, Network, Palette, Plus, Search, Settings, ShieldAlert } from "lucide-react";
import { useActivity } from "@/hooks/use-activity";
import { deriveRunState, isActive } from "@/lib/run-state";
import { formatRelative } from "@/lib/format";
import { providerLabel } from "@/lib/labels";
import { useSettingsStore } from "@/stores/settings-store";
import { cn } from "@/components/ui/cn";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { StatusIcon } from "@/components/ui/status-badge";
import { THEME_LABEL, nextTheme } from "@/components/theme/theme-toggle";
import { describePending, pendingTitle } from "./activity-format";
import { sessionHref } from "./activity";
import { ALL_NAV_ITEMS, SETTINGS_SECTIONS } from "./nav-config";
import { filterItems, moveIndex, normalize, type Searchable } from "./palette-search";
import { useShellOverlays } from "./shell-state";

type GroupId = "jump" | "sessions" | "actions";

const GROUP_LABEL: Record<GroupId, string> = { jump: "Springen", sessions: "Sessions", actions: "Aktionen" };
const GROUP_ORDER: GroupId[] = ["jump", "sessions", "actions"];

interface PaletteItem extends Searchable {
  id: string;
  group: GroupId;
  icon: React.ReactNode;
  hint?: string;
  /** Only listed while the user searches (settings sections). */
  searchOnly?: boolean;
  run: () => void;
}

interface SessionRow {
  id: string;
  title: string;
  cwd: string;
  provider: string;
  model: string;
  status: string;
  updatedAt: string;
}

const MAX_SESSIONS_IDLE = 6;
const MAX_SESSIONS_SEARCH = 20;

/** Recent sessions, fetched each time the palette opens (null while loading or failed). */
function useRecentSessions(): SessionRow[] | null {
  const [sessions, setSessions] = React.useState<SessionRow[] | null>(null);
  React.useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/assistant/sessions", { cache: "no-store", signal: ctrl.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data: { sessions?: SessionRow[] }) => setSessions(Array.isArray(data.sessions) ? data.sessions : []))
      .catch(() => {
        if (!ctrl.signal.aborted) setSessions([]);
      });
    return () => ctrl.abort();
  }, []);
  return sessions;
}

function PaletteBody({ close }: { close: () => void }) {
  const router = useRouter();
  const setShortcuts = useShellOverlays((s) => s.setShortcuts);
  const { runs, pending } = useActivity();
  const theme = useSettingsStore((s) => s.theme);
  const sessions = useRecentSessions();
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const baseId = React.useId();

  const go = React.useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router],
  );

  const items = React.useMemo<PaletteItem[]>(() => {
    const out: PaletteItem[] = [];
    for (const nav of ALL_NAV_ITEMS) {
      const Icon = nav.icon;
      out.push({
        id: `jump:${nav.href}`,
        group: "jump",
        label: nav.label,
        keywords: [nav.href.slice(1)],
        icon: <Icon />,
        hint: nav.goKey ? `G ${nav.goKey}` : undefined,
        run: () => go(nav.href),
      });
    }
    for (const section of SETTINGS_SECTIONS) {
      out.push({
        id: `jump:settings:${section.id}`,
        group: "jump",
        label: `Einstellungen › ${section.label}`,
        keywords: [section.id],
        icon: <Settings />,
        searchOnly: true,
        run: () => go(`/settings?section=${section.id}`),
      });
    }

    // Sessions: active ones first (with their live state), then most recent.
    const rows = (sessions ?? []).map((s, index) => {
      const run = runs.find((r) => r.sessionId === s.id) ?? null;
      const { state } = deriveRunState({
        run: run ? { kind: run.kind, origin: run.origin, startedAt: run.startedAt } : null,
        pending: pending.filter((p) => p.sessionId === s.id),
        attached: false,
        sessionStatus: s.status,
      });
      return { s, index, state };
    });
    rows.sort((a, b) => Number(isActive(b.state)) - Number(isActive(a.state)) || a.index - b.index);
    for (const { s, state } of rows) {
      out.push({
        id: `session:${s.id}`,
        group: "sessions",
        label: s.title || s.cwd,
        keywords: [s.cwd, s.provider, providerLabel(s.provider), s.model],
        icon: <StatusIcon state={state} />,
        hint: [providerLabel(s.provider), formatRelative(s.updatedAt)].join(" · "),
        run: () => go(sessionHref(s.id)),
      });
    }

    out.push({
      id: "action:new-session",
      group: "actions",
      label: "Neue Session",
      keywords: ["starten", "assistent", "new"],
      icon: <Plus />,
      run: () => go("/assistant?new=1"),
    });
    const firstGate = pending[0];
    if (firstGate) {
      out.push({
        id: "action:open-gate",
        group: "actions",
        label: "Offene Freigabe öffnen",
        keywords: ["freigabe", "approval", firstGate.sessionTitle],
        icon: <ShieldAlert />,
        hint: `${pendingTitle(describePending(firstGate))} · ${firstGate.sessionTitle}`,
        run: () => go(sessionHref(firstGate.sessionId)),
      });
    }
    out.push({
      id: "action:orchestra",
      group: "actions",
      label: "Orchester bearbeiten",
      keywords: ["besetzung", "rollen", "modelle"],
      icon: <Network />,
      run: () => go("/orchestra"),
    });
    out.push({
      id: "action:theme",
      group: "actions",
      label: "Design wechseln",
      keywords: ["theme", "dunkel", "hell", "system", "farbe"],
      icon: <Palette />,
      hint: `${THEME_LABEL[theme]} → ${THEME_LABEL[nextTheme(theme)]}`,
      run: () => {
        const { theme, setTheme } = useSettingsStore.getState();
        setTheme(nextTheme(theme));
        close();
      },
    });
    out.push({
      id: "action:push",
      group: "actions",
      label: "Push-Benachrichtigungen",
      keywords: ["benachrichtigungen", "notifications"],
      icon: <Bell />,
      run: () => go("/settings?section=notifications"),
    });
    out.push({
      id: "action:shortcuts",
      group: "actions",
      label: "Tastenkürzel anzeigen",
      keywords: ["shortcuts", "tastatur", "hilfe"],
      icon: <Keyboard />,
      hint: "?",
      run: () => {
        close();
        setShortcuts(true);
      },
    });
    return out;
  }, [sessions, runs, pending, theme, go, close, setShortcuts]);

  // Filter per group (best match first within a group), groups in fixed order.
  const searching = normalize(query) !== "";
  const groups = React.useMemo(() => {
    return GROUP_ORDER.map((group) => {
      let list = items.filter((i) => i.group === group && (searching || !i.searchOnly));
      list = filterItems(list, query);
      if (group === "sessions") list = list.slice(0, searching ? MAX_SESSIONS_SEARCH : MAX_SESSIONS_IDLE);
      return { group, items: list };
    }).filter((g) => g.items.length > 0);
  }, [items, query, searching]);
  const flat = React.useMemo(() => groups.flatMap((g) => g.items), [groups]);

  const activeIndex = flat.length === 0 ? -1 : Math.min(active, flat.length - 1);
  const activeItem = activeIndex >= 0 ? flat[activeIndex] : null;
  const optionId = (item: PaletteItem) => `${baseId}-opt-${item.id}`;
  const listId = `${baseId}-list`;

  const activeOptionId = activeItem ? optionId(activeItem) : undefined;

  React.useEffect(() => {
    if (activeOptionId) document.getElementById(activeOptionId)?.scrollIntoView({ block: "nearest" });
  }, [activeOptionId]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive(moveIndex(activeIndex, e.key === "ArrowDown" ? 1 : -1, flat.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      activeItem?.run();
    } else if ((e.key === "Home" || e.key === "End") && (e.ctrlKey || e.metaKey) && flat.length > 0) {
      e.preventDefault();
      setActive(e.key === "Home" ? 0 : flat.length - 1);
    }
  };

  return (
    <>
      <DialogTitle className="sr-only">Suchen &amp; springen</DialogTitle>
      <DialogDescription className="sr-only">
        Seiten, Sessions und Aktionen suchen. Pfeiltasten wählen aus, Enter öffnet.
      </DialogDescription>
      <div className="flex shrink-0 items-center gap-2 border-b border-border pl-4 pr-2 focus-within:border-primary-border">
        <Search aria-hidden className="size-4 shrink-0 text-subtle-foreground" />
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeOptionId}
          aria-label="Suchen & springen"
          placeholder="Suchen & springen …"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className="h-14 min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-subtle-foreground md:h-12 md:text-sm"
        />
        <Kbd className="hidden md:inline-flex">Esc</Kbd>
        <DialogClose asChild>
          <Button variant="ghost" size="md" className="md:hidden">
            Abbrechen
          </Button>
        </DialogClose>
      </div>

      <div
        id={listId}
        role="listbox"
        aria-label="Ergebnisse"
        className={cn(
          "min-h-0 overflow-y-auto overscroll-contain md:max-h-[min(60vh,440px)]",
          flat.length > 0 && "flex-1 p-2 md:flex-none",
        )}
      >
        {groups.map(({ group, items: groupItems }) => {
          const labelId = `${baseId}-grp-${group}`;
          return (
            <div key={group} role="group" aria-labelledby={labelId} className="pb-1">
              <div id={labelId} role="presentation" className="px-2 pb-1 pt-2 text-xs font-medium text-subtle-foreground">
                {GROUP_LABEL[group]}
                {group === "sessions" && sessions === null ? " · wird geladen …" : ""}
              </div>
              {groupItems.map((item) => {
                const selected = item === activeItem;
                return (
                  <div
                    key={item.id}
                    id={optionId(item)}
                    role="option"
                    aria-selected={selected}
                    onPointerMove={() => {
                      const i = flat.indexOf(item);
                      if (i !== activeIndex) setActive(i);
                    }}
                    // Keep focus in the input (aria-activedescendant pattern).
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => item.run()}
                    className={cn(
                      "flex min-h-11 cursor-pointer select-none items-center gap-3 rounded-md px-2 text-sm text-muted-foreground md:min-h-9 md:text-ui",
                      "[&_svg]:size-4 [&_svg]:shrink-0",
                      selected && "bg-accent text-foreground",
                    )}
                  >
                    <span aria-hidden className={cn("grid size-4 place-items-center", !selected && "text-subtle-foreground")}>
                      {item.icon}
                    </span>
                    <span className={cn("min-w-0 flex-1 truncate", selected ? "text-foreground" : "text-foreground/90")}>
                      {item.label}
                    </span>
                    {item.hint ? (
                      <span className="max-w-[45%] shrink-0 truncate text-xs text-subtle-foreground">{item.hint}</span>
                    ) : null}
                    {selected ? <CornerDownLeft aria-hidden className="hidden text-subtle-foreground md:block" /> : null}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {/* Outside the listbox: a listbox may only contain options and groups. */}
      {flat.length === 0 ? (
        <p className="flex-1 px-4 py-8 text-center text-ui text-muted-foreground md:flex-none">
          Keine Treffer für „{query.trim()}“.
        </p>
      ) : null}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {searching ? (flat.length === 1 ? "1 Ergebnis" : `${flat.length} Ergebnisse`) : ""}
      </p>

      <div className="hidden shrink-0 items-center gap-4 border-t border-border px-4 py-2 text-xs text-subtle-foreground md:flex">
        <span className="inline-flex items-center gap-1">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> auswählen
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>↵</Kbd> öffnen
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>Esc</Kbd> schließen
        </span>
      </div>
    </>
  );
}

/**
 * ⌘K / Ctrl+K palette (DESIGN.md §5.5): a Dialog with a combobox input and a
 * filtered listbox (Springen · Sessions · Aktionen). Full screen below md.
 */
export function CommandPalette() {
  const open = useShellOverlays((s) => s.palette);
  const setPalette = useShellOverlays((s) => s.setPalette);
  const close = React.useCallback(() => setPalette(false), [setPalette]);
  return (
    <Dialog open={open} onOpenChange={setPalette}>
      <DialogContent
        hideClose
        className={cn(
          "top-[12vh] max-w-[580px] translate-y-0",
          "max-md:inset-0 max-md:left-0 max-md:top-0 max-md:h-dvh max-md:max-h-none max-md:w-full max-md:max-w-none max-md:translate-x-0",
          "max-md:rounded-none max-md:border-0 max-md:pt-safe max-md:pb-safe",
        )}
      >
        <PaletteBody close={close} />
      </DialogContent>
    </Dialog>
  );
}
