import { describe, expect, it } from "vitest";
import {
  createSequenceMatcher,
  eventKey,
  isApplePlatform,
  isEditableTarget,
  isPlainCombo,
  matchCombo,
  parseCombo,
  sequenceParts,
  type KeyEventLike,
} from "./hotkeys";

const ev = (key: string, mods: Partial<KeyEventLike> = {}): KeyEventLike => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe("parseCombo", () => {
  it("parses modifiers and the key", () => {
    expect(parseCombo("mod+shift+k")).toEqual({ mod: true, ctrl: false, meta: false, alt: false, shift: true, key: "k" });
    expect(parseCombo("ctrl+alt+Delete")).toMatchObject({ ctrl: true, alt: true, key: "delete" });
    expect(parseCombo("cmd+K")).toMatchObject({ meta: true, key: "k" });
  });

  it("resolves aliases and symbols", () => {
    expect(parseCombo("mod+return").key).toBe("enter");
    expect(parseCombo("esc").key).toBe("escape");
    expect(parseCombo("space").key).toBe(" ");
    expect(parseCombo("?").key).toBe("?");
    expect(parseCombo("/").key).toBe("/");
    expect(parseCombo("mod+\\").key).toBe("\\");
    expect(parseCombo("mod+.").key).toBe(".");
    expect(parseCombo("mod++")).toMatchObject({ mod: true, key: "+" });
    expect(parseCombo("+").key).toBe("+");
  });

  it("knows plain (single-key) combos", () => {
    expect(isPlainCombo(parseCombo("?"))).toBe(true);
    expect(isPlainCombo(parseCombo("shift+n"))).toBe(true);
    expect(isPlainCombo(parseCombo("mod+k"))).toBe(false);
    expect(isPlainCombo(parseCombo("alt+k"))).toBe(false);
  });
});

describe("matchCombo", () => {
  it("maps mod to ⌘ on Mac and Ctrl elsewhere", () => {
    expect(matchCombo(ev("k", { metaKey: true }), "mod+k", true)).toBe(true);
    expect(matchCombo(ev("k", { ctrlKey: true }), "mod+k", true)).toBe(false);
    expect(matchCombo(ev("k", { ctrlKey: true }), "mod+k", false)).toBe(true);
    expect(matchCombo(ev("k", { metaKey: true }), "mod+k", false)).toBe(false);
  });

  it("requires modifiers to match exactly", () => {
    expect(matchCombo(ev("k"), "mod+k", false)).toBe(false);
    expect(matchCombo(ev("k", { ctrlKey: true, altKey: true }), "mod+k", false)).toBe(false);
    expect(matchCombo(ev("b", { ctrlKey: true }), "b", false)).toBe(false);
  });

  it("compares keys case-insensitively", () => {
    expect(matchCombo(ev("K", { metaKey: true, shiftKey: true }), "mod+shift+k", true)).toBe(true);
    expect(matchCombo(ev("Enter", { ctrlKey: true }), "mod+enter", false)).toBe(true);
    expect(matchCombo(ev("Escape"), "esc", false)).toBe(true);
  });

  it("treats Shift as significant for letters", () => {
    expect(matchCombo(ev("K", { shiftKey: true }), "k", false)).toBe(false);
    expect(matchCombo(ev("k"), "shift+k", false)).toBe(false);
    expect(matchCombo(ev("N", { shiftKey: true }), "shift+n", false)).toBe(true);
  });

  it("handles '?' and '/' regardless of the layout's Shift", () => {
    expect(matchCombo(ev("?", { shiftKey: true }), "?", false)).toBe(true); // US: Shift+/, DE: Shift+ß
    expect(matchCombo(ev("/"), "/", false)).toBe(true); // US
    expect(matchCombo(ev("/", { shiftKey: true }), "/", false)).toBe(true); // DE: Shift+7
    expect(matchCombo(ev("?", { shiftKey: true }), "/", false)).toBe(false);
  });

  it("falls back to the physical key when ⌥ or a non-Latin layout changes the character", () => {
    expect(matchCombo(ev("л", { ctrlKey: true, code: "KeyK" }), "mod+k", false)).toBe(true);
    expect(matchCombo(ev("˚", { altKey: true, code: "KeyK" }), "alt+k", true)).toBe(true);
    // Latin layouts keep the character: AZERTY "q" sits on code KeyA.
    expect(matchCombo(ev("q", { code: "KeyA" }), "a", false)).toBe(false);
    expect(eventKey(ev("a", { code: "KeyQ" }))).toBe("a");
  });

  it("accepts a pre-parsed combo and rejects empty keys", () => {
    expect(matchCombo(ev("s", { metaKey: true }), parseCombo("mod+s"), true)).toBe(true);
    expect(matchCombo(ev("s"), parseCombo(""), true)).toBe(false);
  });
});

describe("isEditableTarget", () => {
  it("detects text fields", () => {
    expect(isEditableTarget({ tagName: "INPUT", type: "text" })).toBe(true);
    expect(isEditableTarget({ tagName: "input" })).toBe(true);
    expect(isEditableTarget({ tagName: "INPUT", type: "search" })).toBe(true);
    expect(isEditableTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isEditableTarget({ tagName: "SELECT" })).toBe(true);
  });

  it("detects contenteditable", () => {
    expect(isEditableTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    const attrs: Record<string, string> = { contenteditable: "plaintext-only" };
    expect(isEditableTarget({ tagName: "DIV", getAttribute: (n) => attrs[n] ?? null })).toBe(true);
    expect(isEditableTarget({ tagName: "DIV", getAttribute: (n) => (n === "contenteditable" ? "false" : null) })).toBe(false);
    expect(isEditableTarget({ tagName: "DIV", getAttribute: (n) => (n === "role" ? "textbox" : null) })).toBe(true);
  });

  it("ignores buttons, checkboxes and plain elements", () => {
    expect(isEditableTarget({ tagName: "INPUT", type: "checkbox" })).toBe(false);
    expect(isEditableTarget({ tagName: "INPUT", type: "button" })).toBe(false);
    expect(isEditableTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isEditableTarget({ tagName: "BODY", getAttribute: () => null })).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(undefined)).toBe(false);
  });
});

describe("sequence matcher", () => {
  const SEQS = ["g a", "g o", "g h"];

  it("splits sequences", () => {
    expect(sequenceParts(" g  a ")).toEqual(["g", "a"]);
    expect(sequenceParts("mod+k")).toEqual(["mod+k"]);
  });

  it("matches a sequence typed within the window", () => {
    const m = createSequenceMatcher(1000);
    expect(m.feed("g", 0, SEQS)).toBeNull();
    expect(m.pending(500)).toBe(true);
    expect(m.feed("a", 900, SEQS)).toBe("g a");
    expect(m.pending(901)).toBe(false);
  });

  it("is case-insensitive", () => {
    const m = createSequenceMatcher();
    m.feed("G", 0, SEQS);
    expect(m.feed("O", 10, SEQS)).toBe("g o");
  });

  it("expires after the window", () => {
    const m = createSequenceMatcher(1000);
    m.feed("g", 0, SEQS);
    expect(m.pending(1001)).toBe(false);
    expect(m.feed("a", 1001, SEQS)).toBeNull();
  });

  it("measures the window per step", () => {
    const m = createSequenceMatcher(1000);
    expect(m.feed("x", 0, ["a b c"])).toBeNull();
    expect(m.feed("a", 100, ["a b c"])).toBeNull();
    expect(m.feed("b", 1000, ["a b c"])).toBeNull();
    expect(m.feed("c", 1900, ["a b c"])).toBe("a b c");
  });

  it("recovers from stray and repeated keys", () => {
    const m = createSequenceMatcher();
    expect(m.feed("x", 0, SEQS)).toBeNull();
    expect(m.feed("g", 10, SEQS)).toBeNull();
    expect(m.feed("g", 20, SEQS)).toBeNull();
    expect(m.feed("h", 30, SEQS)).toBe("g h");
  });

  it("does not match unrelated keys and resets on demand", () => {
    const m = createSequenceMatcher();
    expect(m.feed("a", 0, SEQS)).toBeNull();
    expect(m.pending(1)).toBe(false);
    m.feed("g", 10, SEQS);
    m.reset();
    expect(m.feed("a", 20, SEQS)).toBeNull();
  });
});

describe("isApplePlatform", () => {
  it("detects Apple devices", () => {
    expect(isApplePlatform({ platform: "MacIntel" })).toBe(true);
    expect(isApplePlatform({ userAgentData: { platform: "macOS" } })).toBe(true);
    expect(isApplePlatform({ platform: "", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" })).toBe(true);
    expect(isApplePlatform({ platform: "Win32" })).toBe(false);
    expect(isApplePlatform({ platform: "Linux x86_64" })).toBe(false);
    expect(isApplePlatform(undefined)).toBe(false);
  });
});
