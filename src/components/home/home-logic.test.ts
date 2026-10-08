import { describe, expect, it } from "vitest";
import { folderLabel, isFirstRun, newSessionHref, promptVersionLabel, recentFolders, usageSince } from "./home-logic";

const DAY = 24 * 60 * 60 * 1000;

describe("folderLabel", () => {
  it("returns the last path segment", () => {
    expect(folderLabel("/home/u/code/webshop")).toBe("webshop");
    expect(folderLabel("/home/u/code/webshop/")).toBe("webshop");
    expect(folderLabel("C:\\Users\\me\\proj")).toBe("proj");
  });
  it("falls back to the path itself", () => {
    expect(folderLabel("/")).toBe("/");
    expect(folderLabel("proj")).toBe("proj");
  });
});

describe("recentFolders", () => {
  it("keeps order, drops duplicates and blanks, limits to n", () => {
    const sessions = [{ cwd: "/a/x" }, { cwd: "/a/y" }, { cwd: "/a/x" }, { cwd: "" }, { cwd: "/a/z" }, { cwd: "/a/w" }];
    expect(recentFolders(sessions, 3)).toEqual([
      { path: "/a/x", label: "x" },
      { path: "/a/y", label: "y" },
      { path: "/a/z", label: "z" },
    ]);
  });
  it("handles an empty list", () => {
    expect(recentFolders([])).toEqual([]);
  });
});

describe("newSessionHref", () => {
  it("encodes the folder", () => {
    expect(newSessionHref()).toBe("/assistant?new=1");
    expect(newSessionHref("/home/u/my app")).toBe("/assistant?new=1&cwd=%2Fhome%2Fu%2Fmy%20app");
  });
});

describe("usageSince", () => {
  const now = Date.UTC(2026, 9, 7, 12);
  it("counts sessions of the last 7 days and sums known positive costs", () => {
    const sessions = [
      { updatedAt: new Date(now - DAY).toISOString(), totalCostUsd: 0.5 },
      { updatedAt: new Date(now - 6 * DAY).toISOString(), totalCostUsd: null },
      { updatedAt: new Date(now - 2 * DAY).toISOString(), totalCostUsd: 0 },
      { updatedAt: new Date(now - 8 * DAY).toISOString(), totalCostUsd: 9 },
      { updatedAt: "kaputt", totalCostUsd: 1 },
    ];
    expect(usageSince(sessions, now, 7)).toEqual({ sessions: 3, costUsd: 0.5 });
  });
});

describe("isFirstRun", () => {
  it("only without sessions and providers", () => {
    expect(isFirstRun(0, 0)).toBe(true);
    expect(isFirstRun(1, 0)).toBe(false);
    expect(isFirstRun(0, 1)).toBe(false);
  });
});

describe("promptVersionLabel", () => {
  it("shows the version count when there is one", () => {
    expect(promptVersionLabel({ id: "p", title: "t", updatedAt: "", _count: { versions: 3 } })).toBe("v3");
    expect(promptVersionLabel({ id: "p", title: "t", updatedAt: "" })).toBeNull();
  });
});
