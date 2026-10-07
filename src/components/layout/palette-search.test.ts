import { describe, expect, it } from "vitest";
import { filterItems, matchScore, moveIndex, normalize } from "./palette-search";

const items = [
  { label: "Start" },
  { label: "Assistent", keywords: ["assistant"] },
  { label: "Einstellungen › GitHub", keywords: ["github"] },
  { label: "Einstellungen › App & Updates", keywords: ["app"] },
  { label: "Neue Session", keywords: ["starten"] },
  { label: "Über die App" },
];

describe("normalize", () => {
  it("is case- and accent-insensitive", () => {
    expect(normalize("  Über ")).toBe("uber");
  });
});

describe("filterItems", () => {
  it("returns everything for an empty query", () => {
    expect(filterItems(items, "  ")).toBe(items);
  });

  it("ranks prefix over word start over substring over keywords", () => {
    const labels = filterItems(items, "st").map((i) => i.label);
    // "Start" (prefix) before "Assistent" (substring) and "Neue Session" (keyword "starten")
    expect(labels[0]).toBe("Start");
    expect(labels).toContain("Assistent");
    expect(labels.indexOf("Assistent")).toBeLessThan(labels.indexOf("Neue Session"));
  });

  it("matches words after separators and needs every word", () => {
    expect(filterItems(items, "git").map((i) => i.label)).toEqual(["Einstellungen › GitHub"]);
    expect(filterItems(items, "einst app").map((i) => i.label)).toEqual(["Einstellungen › App & Updates"]);
    expect(filterItems(items, "einst zzz")).toEqual([]);
  });

  it("ignores accents in the query and the label", () => {
    expect(filterItems(items, "uber").map((i) => i.label)).toEqual(["Über die App"]);
  });

  it("scores 0 for no match", () => {
    expect(matchScore({ label: "Start" }, "xyz")).toBe(0);
  });
});

describe("moveIndex", () => {
  it("wraps around and handles empty lists", () => {
    expect(moveIndex(0, 1, 3)).toBe(1);
    expect(moveIndex(2, 1, 3)).toBe(0);
    expect(moveIndex(0, -1, 3)).toBe(2);
    expect(moveIndex(-1, 1, 3)).toBe(0);
    expect(moveIndex(-1, -1, 3)).toBe(2);
    expect(moveIndex(0, 1, 0)).toBe(-1);
  });
});
