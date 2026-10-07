"use client";

import * as React from "react";
import { Kbd } from "@/components/ui/kbd";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useShellOverlays } from "./shell-state";
import { useIsApple } from "./use-client-info";

/** One key chord: keys pressed together. "mod" renders ⌘ / Strg. */
type Chord = string[];

interface ShortcutRow {
  /** Alternatives ("⌘K" or "/"); each is a chord or a "then" sequence. */
  keys: { chord: Chord; then?: Chord[] }[];
  label: string;
  /** Extra condition shown under the label. */
  note?: string;
}

const G_THEN = (k: string) => ({ chord: ["G"], then: [[k]] });

// DESIGN.md §5.6, every row including the assistant and orchestra ones.
const SECTIONS: { title: string; rows: ShortcutRow[] }[] = [
  {
    title: "Überall",
    rows: [
      { keys: [{ chord: ["mod", "K"] }, { chord: ["/"] }], label: "Suchen & springen (Befehlspalette)" },
      { keys: [{ chord: ["mod", "B"] }], label: "Seitenleiste ein/aus" },
      { keys: [G_THEN("A")], label: "Zum Assistenten" },
      { keys: [G_THEN("O")], label: "Zum Orchester" },
      { keys: [G_THEN("S")], label: "Zu den Einstellungen" },
      { keys: [G_THEN("B")], label: "Zum Builder" },
      { keys: [G_THEN("L")], label: "Zur Bibliothek" },
      { keys: [G_THEN("H")], label: "Zur Startseite" },
      { keys: [{ chord: ["?"] }], label: "Tastenkürzel anzeigen" },
      { keys: [{ chord: ["Esc"] }], label: "Oberste Ebene schließen" },
    ],
  },
  {
    title: "Assistent",
    rows: [
      { keys: [{ chord: ["N"] }], label: "Neue Session" },
      { keys: [{ chord: ["J"] }, { chord: ["K"] }], label: "Nächste / vorherige Session" },
      { keys: [{ chord: ["mod", "\\"] }], label: "Session-Liste ein/aus" },
      { keys: [{ chord: ["mod", "↵"] }], label: "Senden", note: "im Eingabefeld" },
      { keys: [{ chord: ["mod", "."] }], label: "Lauf stoppen" },
      {
        keys: [{ chord: ["A"] }, { chord: ["D"] }, { chord: ["H"] }],
        label: "Freigeben / Ablehnen / Mit Hinweis ablehnen",
        note: "während eine Freigabe-Karte den Fokus hat",
      },
    ],
  },
  {
    title: "Orchester & Builder",
    rows: [{ keys: [{ chord: ["mod", "S"] }], label: "Speichern" }],
  },
];

function ChordKeys({ chord, isApple }: { chord: Chord; isApple: boolean }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {chord.map((k, i) => (
        <Kbd key={i}>{k === "mod" ? (isApple ? "⌘" : "Strg") : k}</Kbd>
      ))}
    </span>
  );
}

function Keys({ row, isApple }: { row: ShortcutRow; isApple: boolean }) {
  return (
    <span className="flex shrink-0 items-center justify-end gap-1 whitespace-nowrap text-xs text-subtle-foreground">
      {row.keys.map((alt, i) => (
        <React.Fragment key={i}>
          {i > 0 ? <span className="px-0.5">/</span> : null}
          <ChordKeys chord={alt.chord} isApple={isApple} />
          {alt.then?.map((c, j) => (
            <React.Fragment key={j}>
              <span className="px-0.5">dann</span>
              <ChordKeys chord={c} isApple={isApple} />
            </React.Fragment>
          ))}
        </React.Fragment>
      ))}
    </span>
  );
}

/** `?` help sheet listing every shortcut of §5.6 with German descriptions. */
export function ShortcutsHelp() {
  const open = useShellOverlays((s) => s.shortcuts);
  const setShortcuts = useShellOverlays((s) => s.setShortcuts);
  const isApple = useIsApple() ?? false;
  return (
    <Sheet open={open} onOpenChange={setShortcuts}>
      <SheetContent side="auto">
        <SheetHeader>
          <SheetTitle>Tastenkürzel</SheetTitle>
          <SheetDescription>
            Einzelne Tasten wirken nicht, solange ein Eingabefeld den Fokus hat.
          </SheetDescription>
        </SheetHeader>
        {/* Focusable so keyboard users can scroll the list (it has no controls). */}
        <SheetBody tabIndex={0} aria-label="Liste der Tastenkürzel" role="region" className="flex flex-col gap-5 pb-6 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
          {SECTIONS.map((section) => (
            <section key={section.title} aria-label={section.title}>
              <h3 className="pb-1.5 text-xs font-medium text-subtle-foreground">{section.title}</h3>
              <dl className="divide-y divide-border rounded-lg border border-border">
                {section.rows.map((row) => (
                  <div key={row.label} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <dt className="min-w-0 flex-1 text-ui">
                      {row.label}
                      {row.note ? <span className="block text-xs text-muted-foreground">{row.note}</span> : null}
                    </dt>
                    <dd>
                      <Keys row={row} isApple={isApple} />
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
