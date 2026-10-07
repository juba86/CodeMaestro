"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import type { DiffPart } from "@/lib/assistant/approvals";
import { useIsMobile } from "@/hooks/use-media-query";
import { cn } from "./cn";
import { Button } from "./button";
import { SegmentedControl, SegmentedItem } from "./segmented-control";

/* ------------------------------------------------------------------------ */
/* Pure model                                                                */
/* ------------------------------------------------------------------------ */

export interface DiffLineRow {
  kind: "line";
  op: DiffPart["op"];
  text: string;
  /** Line number in the old file (equal + del), else null. */
  oldNo: number | null;
  /** Line number in the new file (equal + add), else null. */
  newNo: number | null;
}

export interface DiffCollapsedRow {
  kind: "collapsed";
  /** Stable key for expand state. */
  id: string;
  /** The hidden unchanged lines (all `op: "equal"`). */
  lines: DiffLineRow[];
}

export type DiffRow = DiffLineRow | DiffCollapsedRow;

export interface DiffLineOptions {
  /** Unchanged lines kept around each change. */
  context?: number;
  /** Unchanged runs longer than this are collapsed (keeping `context`). */
  collapseOver?: number;
}

/** Split a part into lines; a single trailing newline terminates the last line. */
function splitPart(text: string): string[] {
  if (!text.includes("\n")) return [text];
  const lines = text.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Turn diff parts (one or more lines each) into numbered rows, collapsing long
 * unchanged runs into expandable hunks. Runs at the start/end of the file only
 * keep context towards the nearest change. A hunk hides at least 2 lines.
 */
export function toDiffLines(parts: DiffPart[], { context = 3, collapseOver = 6 }: DiffLineOptions = {}): DiffRow[] {
  const ctx = Math.max(0, Math.floor(context));
  const lines: DiffLineRow[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const part of parts) {
    for (const text of splitPart(part.text)) {
      if (part.op === "equal") {
        oldNo += 1;
        newNo += 1;
        lines.push({ kind: "line", op: "equal", text, oldNo, newNo });
      } else if (part.op === "del") {
        oldNo += 1;
        lines.push({ kind: "line", op: "del", text, oldNo, newNo: null });
      } else {
        newNo += 1;
        lines.push({ kind: "line", op: "add", text, oldNo: null, newNo });
      }
    }
  }

  const out: DiffRow[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].op !== "equal") {
      out.push(lines[i]);
      i += 1;
      continue;
    }
    let j = i;
    while (j < lines.length && lines[j].op === "equal") j += 1;
    const run = lines.slice(i, j);
    const atStart = i === 0;
    const atEnd = j === lines.length;
    // Keep context towards neighbouring changes; a file without any change
    // keeps its first lines visible.
    const keepHead = atStart && !atEnd ? 0 : ctx;
    const keepTail = atEnd ? 0 : ctx;
    const head = run.slice(0, keepHead);
    const tail = run.slice(run.length - Math.min(keepTail, run.length));
    const hidden = run.slice(head.length, run.length - tail.length);

    if (run.length > collapseOver && hidden.length >= 2) {
      out.push(...head);
      const first = hidden[0];
      out.push({ kind: "collapsed", id: `c${first.oldNo}-${first.newNo}`, lines: hidden });
      out.push(...tail);
    } else {
      out.push(...run);
    }
    i = j;
  }
  return out;
}

export function diffStats(parts: DiffPart[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const p of parts) {
    const n = splitPart(p.text).length;
    if (p.op === "add") added += n;
    else if (p.op === "del") removed += n;
  }
  return { added, removed };
}

/* ------------------------------------------------------------------------ */
/* Wrap preference (localStorage "cm-diff-wrap", shared by all diff views)  */
/* ------------------------------------------------------------------------ */

const WRAP_KEY = "cm-diff-wrap";
let wrapPref: boolean | null | undefined; // undefined = not read yet
const wrapListeners = new Set<() => void>();

function readWrapPref(): boolean | null {
  if (wrapPref !== undefined) return wrapPref;
  try {
    const v = window.localStorage.getItem(WRAP_KEY);
    wrapPref = v === "1" ? true : v === "0" ? false : null;
  } catch {
    wrapPref = null;
  }
  return wrapPref;
}

function writeWrapPref(v: boolean) {
  wrapPref = v;
  try {
    window.localStorage.setItem(WRAP_KEY, v ? "1" : "0");
  } catch {
    // private mode: keep it in memory
  }
  for (const l of wrapListeners) l();
}

function subscribeWrap(l: () => void) {
  wrapListeners.add(l);
  return () => {
    wrapListeners.delete(l);
  };
}

/** Wrap long lines? Remembered per device; default: wrap on mobile, scroll on desktop. */
export function useDiffWrap(): [boolean, (wrap: boolean) => void] {
  const isMobile = useIsMobile();
  const pref = React.useSyncExternalStore(subscribeWrap, readWrapPref, () => null);
  return [pref ?? isMobile, writeWrapPref];
}

export function DiffWrapToggle({ className }: { className?: string }) {
  const [wrap, setWrap] = useDiffWrap();
  return (
    <SegmentedControl
      size="sm"
      aria-label="Lange Zeilen"
      value={wrap ? "wrap" : "scroll"}
      onValueChange={(v) => setWrap(v === "wrap")}
      className={className}
    >
      <SegmentedItem value="wrap">Umbrechen</SegmentedItem>
      <SegmentedItem value="scroll">Scrollen</SegmentedItem>
    </SegmentedControl>
  );
}

/* ------------------------------------------------------------------------ */
/* View                                                                      */
/* ------------------------------------------------------------------------ */

export type DiffViewProps = {
  parts: DiffPart[];
  /** Show at most this many rows until „Ganzen Diff anzeigen". */
  maxLines?: number;
  context?: number;
  collapseOver?: number;
  /** Header content on the left (e.g. the file path and badges). */
  title?: React.ReactNode;
  /** Show „+n −m" in the header (default true). */
  showStats?: boolean;
  /** Show the Umbrechen / Scrollen toggle in the header (default true). */
  showWrapToggle?: boolean;
  /** Force wrapping (e.g. in a full-screen sheet); otherwise the remembered preference. */
  wrap?: boolean;
  /** Name of the scrollable diff, e.g. „Änderungen an helpers.ts" (default „Änderungen"). */
  "aria-label"?: string;
  className?: string;
};

const ROW_GRID = "grid grid-cols-[2.25rem_1.25rem_minmax(0,1fr)]";

function lineCount(n: number) {
  return n === 1 ? "1 unveränderte Zeile" : `${n} unveränderte Zeilen`;
}

export function DiffView({
  parts,
  maxLines,
  context,
  collapseOver,
  title,
  showStats = true,
  showWrapToggle = true,
  wrap: wrapProp,
  "aria-label": ariaLabel = "Änderungen",
  className,
}: DiffViewProps) {
  const rows = React.useMemo(() => toDiffLines(parts, { context, collapseOver }), [parts, context, collapseOver]);
  const stats = React.useMemo(() => diffStats(parts), [parts]);
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(() => new Set());
  const [showAll, setShowAll] = React.useState(false);
  const [wrapPrefValue] = useDiffWrap();
  const wrap = wrapProp ?? wrapPrefValue;
  const regionRef = React.useRef<HTMLDivElement | null>(null);

  // The hunk button disappears once expanded: keep keyboard focus in the diff.
  const expand = (id: string, button: HTMLElement) => {
    const hadFocus = document.activeElement === button;
    setExpanded((s) => new Set(s).add(id));
    if (hadFocus) requestAnimationFrame(() => regionRef.current?.focus({ preventScroll: true }));
  };

  const display = React.useMemo(() => {
    const flat: DiffRow[] = [];
    for (const r of rows) {
      if (r.kind === "collapsed" && expanded.has(r.id)) flat.push(...r.lines);
      else flat.push(r);
    }
    return flat;
  }, [rows, expanded]);

  const limited = maxLines != null && !showAll && display.length > maxLines;
  const visible = limited ? display.slice(0, maxLines) : display;
  const hasHeader = Boolean(title) || showStats || (showWrapToggle && wrapProp === undefined);

  return (
    <div data-slot="diff-view" className={cn("min-w-0 overflow-hidden rounded-lg border border-border bg-background", className)}>
      {hasHeader ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-surface-2 px-3 py-1.5 text-xs">
          <div className="flex min-w-0 flex-[1_1_14rem] flex-wrap items-center gap-2 [overflow-wrap:anywhere]">{title}</div>
          {showStats ? (
            <span className="font-mono tabular-nums">
              <span className="text-diff-add-strong">+{stats.added}</span>{" "}
              <span className="text-diff-del-strong">−{stats.removed}</span>
              <span className="sr-only">
                {" "}
                ({stats.added} Zeilen hinzugefügt, {stats.removed} entfernt)
              </span>
            </span>
          ) : null}
          {showWrapToggle && wrapProp === undefined ? <DiffWrapToggle /> : null}
        </div>
      ) : null}

      <div
        ref={regionRef}
        role="group"
        aria-label={ariaLabel}
        tabIndex={0}
        className={cn(
          "py-1 font-mono text-xs leading-5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
          !wrap && "overflow-x-auto",
        )}
      >
        <div className={cn(!wrap && "min-w-max")}>
          {visible.map((row, idx) =>
            row.kind === "collapsed" ? (
              <button
                key={row.id}
                type="button"
                aria-expanded={false}
                onClick={(e) => expand(row.id, e.currentTarget)}
                className="flex h-8 w-full items-center gap-2 pl-9 pr-3 text-left text-subtle-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring md:h-6"
              >
                <ChevronDown aria-hidden className="size-3" />
                {lineCount(row.lines.length)}
              </button>
            ) : (
              <div
                key={`${row.oldNo}-${row.newNo}-${idx}`}
                className={cn(
                  ROW_GRID,
                  row.op === "add" && "bg-diff-add text-diff-add-strong",
                  row.op === "del" && "bg-diff-del text-diff-del-strong",
                )}
              >
                <span aria-hidden className="select-none pr-2 text-right text-subtle-foreground">
                  {row.op === "del" ? row.oldNo : row.newNo}
                </span>
                <span aria-hidden className="select-none text-center">
                  {row.op === "add" ? "+" : row.op === "del" ? "−" : ""}
                </span>
                <span
                  className={cn(
                    "pr-3",
                    wrap ? "whitespace-pre-wrap break-words [overflow-wrap:anywhere]" : "whitespace-pre",
                    row.op === "equal" && "text-muted-foreground",
                  )}
                >
                  {row.op === "add" ? <span className="sr-only">Hinzugefügt: </span> : null}
                  {row.op === "del" ? <span className="sr-only">Entfernt: </span> : null}
                  {row.text === "" ? "​" : row.text}
                </span>
              </div>
            ),
          )}
        </div>
      </div>

      {limited ? (
        <div className="border-t border-border px-2 py-1.5">
          <Button variant="ghost" size="sm" onClick={() => setShowAll(true)}>
            Ganzen Diff anzeigen
            <span className="text-subtle-foreground tabular-nums">({display.length - (maxLines ?? 0)} weitere Zeilen)</span>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
