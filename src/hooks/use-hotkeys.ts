"use client";

import { useEffect, useEffectEvent } from "react";
import {
  createSequenceMatcher,
  eventKey,
  isApplePlatform,
  isEditableTarget,
  isPlainCombo,
  matchCombo,
  parseCombo,
  type Combo,
  type TargetLike,
} from "@/lib/hotkeys";

export interface HotkeyOptions {
  /** Default true. */
  enabled?: boolean;
  /** Modifier combos that may fire while a text field has focus, e.g. "mod+enter", "mod+s", "mod+k". */
  allowInInputs?: string[];
  /** Fire even while a modal dialog is open (default false). */
  allowInDialogs?: boolean;
}

export type HotkeyHandler = (e: KeyboardEvent) => void;

// Layers that own the keyboard while open: Radix dialogs/sheets
// (data-state="open"), alert dialogs (mounted only while open, "closed" during
// the exit animation), and open menus/select listboxes, whose letter typeahead
// must not also trigger page shortcuts.
const MODAL_SELECTOR = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"]:not([data-state="closed"])',
  '[role="menu"][data-state="open"]',
  '[role="listbox"][data-state="open"]',
].join(", ");
// Popovers are role="dialog" too but non-modal; they sit in a popper wrapper.
const POPPER_WRAPPER = "[data-radix-popper-content-wrapper]";

function modalOpen(): boolean {
  for (const el of document.querySelectorAll(MODAL_SELECTOR)) {
    if (el.getAttribute("role") === "dialog" && el.closest(POPPER_WRAPPER)) continue;
    return true;
  }
  return false;
}
const MODIFIER_KEYS = new Set(["shift", "control", "alt", "meta", "altgraph", "capslock", "os", "fn", "hyper", "super"]);

const comboCache = new Map<string, Combo>();
function combo(s: string): Combo {
  let c = comboCache.get(s);
  if (!c) {
    c = parseCombo(s);
    comboCache.set(s, c);
  }
  return c;
}

const isSequence = (binding: string) => /\s/.test(binding.trim());

/**
 * Global keyboard shortcuts (DESIGN.md §5.6). Keys of `bindings` are combos
 * ("mod+k", "?", "shift+n") or space-separated sequences ("g a", typed within
 * 1s). Rules:
 * - single keys and sequences never fire while focus is in an input,
 *   textarea, select or contenteditable; modifier combos fire there only when
 *   listed in `allowInInputs`;
 * - nothing fires while a modal layer (dialog, sheet, alert dialog, open menu
 *   or select) is open unless `allowInDialogs` is set; non-modal popovers do
 *   not block;
 * - auto-repeat, IME composition and events a closer handler already
 *   consumed (`defaultPrevented`) are ignored;
 * - a match calls `preventDefault()`; the first matching binding wins.
 * The latest `bindings` are always used without re-subscribing.
 */
export function useHotkeys(bindings: Record<string, HotkeyHandler>, opts: HotkeyOptions = {}): void {
  const enabled = opts.enabled ?? true;

  const onKeyDown = useEffectEvent((e: KeyboardEvent, isMac: boolean, sequences: ReturnType<typeof createSequenceMatcher>) => {
    if (e.defaultPrevented || e.isComposing || e.repeat || e.key === "Process") return;
    if (MODIFIER_KEYS.has((e.key ?? "").toLowerCase())) return;
    if (!opts.allowInDialogs && modalOpen()) return;

    const editable = isEditableTarget(e.target as TargetLike | null);
    const keys = Object.keys(bindings);

    // Sequences ("g a"): plain keystrokes outside text fields only.
    const seqBindings = keys.filter(isSequence);
    const plainKeystroke = !e.ctrlKey && !e.metaKey && !e.altKey;
    if (seqBindings.length > 0) {
      if (editable || !plainKeystroke) {
        sequences.reset();
      } else {
        const hit = sequences.feed(eventKey(e), e.timeStamp || Date.now(), seqBindings);
        if (hit) {
          e.preventDefault();
          bindings[hit](e);
          return;
        }
      }
    }

    const allowed = opts.allowInInputs ?? [];
    for (const key of keys) {
      if (isSequence(key)) continue;
      const c = combo(key);
      if (!matchCombo(e, c, isMac)) continue;
      if (editable && (isPlainCombo(c) || !allowed.some((a) => matchCombo(e, combo(a), isMac)))) continue;
      e.preventDefault();
      bindings[key](e);
      return;
    }
  });

  useEffect(() => {
    if (!enabled) return;
    const isMac = isApplePlatform(navigator);
    const sequences = createSequenceMatcher();
    const listener = (e: KeyboardEvent) => onKeyDown(e, isMac, sequences);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [enabled]);
}
