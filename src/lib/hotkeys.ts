// Pure keyboard-shortcut helpers behind useHotkeys (src/hooks/use-hotkeys.ts).
// Combos are written "mod+shift+k": "mod" is ⌘ on macOS and Ctrl elsewhere;
// sequences are space-separated combos ("g a") typed within a short window.

export interface Combo {
  mod: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  /** Normalised `KeyboardEvent.key`: lower-case, aliases resolved. */
  key: string;
}

/** The KeyboardEvent fields the matcher reads (plain objects work in tests). */
export interface KeyEventLike {
  key: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

const KEY_ALIASES: Record<string, string> = {
  esc: "escape",
  return: "enter",
  space: " ",
  spacebar: " ",
  plus: "+",
  up: "arrowup",
  down: "arrowdown",
  left: "arrowleft",
  right: "arrowright",
  del: "delete",
};

function normaliseKey(key: string): string {
  const k = key.length === 1 ? key.toLowerCase() : key.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(KEY_ALIASES, k) ? KEY_ALIASES[k] : k;
}

/** Parses "mod+shift+k" (also "?", "mod+enter", "mod+\\", "mod++"). */
export function parseCombo(combo: string): Combo {
  const out: Combo = { mod: false, ctrl: false, meta: false, alt: false, shift: false, key: "" };
  const raw = combo.trim();
  // A trailing "+" after a separator is the plus key itself ("mod++").
  const parts = raw.endsWith("++") ? [...raw.slice(0, -2).split("+"), "+"] : raw === "+" ? ["+"] : raw.split("+");
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const p = part.trim().toLowerCase();
    if (i < parts.length - 1) {
      if (p === "mod") out.mod = true;
      else if (p === "ctrl" || p === "control") out.ctrl = true;
      else if (p === "meta" || p === "cmd" || p === "command") out.meta = true;
      else if (p === "alt" || p === "option") out.alt = true;
      else if (p === "shift") out.shift = true;
      continue;
    }
    out.key = normaliseKey(part);
  }
  return out;
}

/** True when the combo has no Ctrl/⌘/Alt (a "single key", Shift allowed). */
export function isPlainCombo(c: Combo): boolean {
  return !c.mod && !c.ctrl && !c.meta && !c.alt;
}

const isLetterOrDigit = (k: string) => /^[a-z0-9]$/.test(k);
const isPrintableAscii = (k: string) => k.length === 1 && k >= " " && k <= "~";

/**
 * Normalised key of an event. When ⌥ or a non-Latin layout turns a letter or
 * digit into another character ("˚", "л"), the physical `code` (KeyK, Digit1)
 * decides instead. Latin layouts keep `key`, so AZERTY's "a" stays "a".
 */
export function eventKey(e: KeyEventLike): string {
  const raw = e.key ?? "";
  if (!isPrintableAscii(raw) && e.code) {
    const m = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(e.code);
    if (m) return (m[1] ?? m[2]).toLowerCase();
  }
  return normaliseKey(raw);
}

/**
 * Whether a key event matches a combo. Keys compare case-insensitively (see
 * `eventKey`). Shift must match exactly for letters, digits and named keys;
 * for symbols ("?", "/", ".") the character already encodes Shift on the
 * active layout (e.g. "/" is Shift+7 on German keyboards), so Shift is ignored
 * unless the combo asks for it.
 */
export function matchCombo(e: KeyEventLike, combo: string | Combo, isMac: boolean): boolean {
  const c = typeof combo === "string" ? parseCombo(combo) : combo;
  if (!c.key) return false;
  const wantCtrl = c.ctrl || (c.mod && !isMac);
  const wantMeta = c.meta || (c.mod && isMac);
  if (!!e.ctrlKey !== wantCtrl || !!e.metaKey !== wantMeta || !!e.altKey !== c.alt) return false;
  if (eventKey(e) !== c.key) return false;

  const shiftSignificant = c.shift || isLetterOrDigit(c.key) || c.key.length > 1;
  return !shiftSignificant || !!e.shiftKey === c.shift;
}

/** Minimal shape of an event target for the editable check. */
export interface TargetLike {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
}

// <input> types that do not take typed text: shortcuts may fire there.
const NON_TEXT_INPUTS = new Set(["button", "checkbox", "radio", "submit", "reset", "range", "color", "file", "image"]);

/** True for text inputs, textareas, selects and contenteditable elements. */
export function isEditableTarget(target: TargetLike | null | undefined): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = (target.tagName ?? "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !NON_TEXT_INPUTS.has((target.type ?? "text").toLowerCase());
  const ce = target.getAttribute?.("contenteditable");
  if (ce != null && ce.toLowerCase() !== "false") return true;
  return target.getAttribute?.("role") === "textbox";
}

/** Splits "g a" into its combos; a single combo yields one element. */
export function sequenceParts(binding: string): string[] {
  return binding.trim().split(/\s+/).filter(Boolean);
}

export const SEQUENCE_WINDOW_MS = 1000;

/**
 * Tracks typed keys for "g a"-style sequences. Each step must follow the
 * previous one within `windowMs`. `feed` returns the completed sequence (as
 * written in `sequences`) or null.
 */
export function createSequenceMatcher(windowMs: number = SEQUENCE_WINDOW_MS) {
  let buffer: string[] = [];
  let last = -Infinity;

  return {
    feed(key: string, now: number, sequences: string[]): string | null {
      if (now - last > windowMs) buffer = [];
      last = now;
      buffer.push(normaliseKey(key));

      const parsed = sequences.map((s) => ({ s, parts: sequenceParts(s).map((p) => normaliseKey(p)) }));
      // Drop leading keys until the buffer is a prefix of some sequence, so a
      // stray key before "g a" does not block it.
      while (buffer.length > 0) {
        const hit = parsed.find((p) => p.parts.length === buffer.length && p.parts.every((k, i) => k === buffer[i]));
        if (hit) {
          buffer = [];
          last = -Infinity;
          return hit.s;
        }
        const isPrefix = parsed.some((p) => p.parts.length > buffer.length && buffer.every((k, i) => k === p.parts[i]));
        if (isPrefix) return null;
        buffer = buffer.slice(1);
      }
      return null;
    },
    /** True while a sequence prefix is waiting for its next key. */
    pending(now: number): boolean {
      return buffer.length > 0 && now - last <= windowMs;
    },
    reset() {
      buffer = [];
      last = -Infinity;
    },
  };
}

export type SequenceMatcher = ReturnType<typeof createSequenceMatcher>;

/** Best-effort platform check for the "mod" key (⌘ on Apple devices). */
export function isApplePlatform(nav?: { platform?: string; userAgent?: string; userAgentData?: { platform?: string } }): boolean {
  if (!nav) return false;
  const p = nav.userAgentData?.platform || nav.platform || nav.userAgent || "";
  return /mac|iphone|ipad|ipod/i.test(p);
}
