import { describe, expect, it } from "vitest";
import {
  ALL_NAV_ITEMS,
  GO_SHORTCUTS,
  SETTINGS_SECTIONS,
  activeNavHref,
  activeTab,
  isFullBleedRoute,
  isPromptRoute,
  matchesRoute,
  titleForPath,
  workspaceRouteOf,
} from "./nav-config";

describe("matchesRoute", () => {
  it("matches the root only exactly", () => {
    expect(matchesRoute("/", "/")).toBe(true);
    expect(matchesRoute("/assistant", "/")).toBe(false);
  });

  it("matches sub-pages on a segment boundary", () => {
    expect(matchesRoute("/assistant", "/assistant")).toBe(true);
    expect(matchesRoute("/assistant/x", "/assistant")).toBe(true);
    expect(matchesRoute("/assistants", "/assistant")).toBe(false);
  });
});

describe("titleForPath", () => {
  it("uses the German nav labels", () => {
    expect(titleForPath("/")).toBe("Start");
    expect(titleForPath("/assistant")).toBe("Assistent");
    expect(titleForPath("/orchestra")).toBe("Orchester");
    expect(titleForPath("/library")).toBe("Bibliothek");
    expect(titleForPath("/templates")).toBe("Vorlagen");
    expect(titleForPath("/knowledge")).toBe("Wissensbasis");
    expect(titleForPath("/settings")).toBe("Einstellungen");
  });

  it("falls back to the app name for unknown pages", () => {
    expect(titleForPath("/game")).toBe("CodeMaestro");
  });
});

describe("activeNavHref", () => {
  it("finds the nav item for sub-pages", () => {
    expect(activeNavHref("/settings/whatever")).toBe("/settings");
    expect(activeNavHref("/")).toBe("/");
    expect(activeNavHref("/nope")).toBeNull();
  });
});

describe("tab bar mapping", () => {
  it("marks Prompts active on all four prompt pages", () => {
    for (const p of ["/builder", "/library", "/templates", "/playground"]) {
      expect(activeTab(p)).toBe("prompts");
      expect(isPromptRoute(p)).toBe(true);
    }
    expect(isPromptRoute("/assistant")).toBe(false);
  });

  it("marks Mehr active on the pages reached through the sheet", () => {
    expect(activeTab("/settings")).toBe("more");
    expect(activeTab("/knowledge")).toBe("more");
  });

  it("maps the main tabs", () => {
    expect(activeTab("/")).toBe("start");
    expect(activeTab("/assistant")).toBe("assistant");
    expect(activeTab("/orchestra")).toBe("orchestra");
    expect(activeTab("/game")).toBeNull();
  });
});

describe("workspace routes", () => {
  it("are full-bleed and keyed for sidebar prefs", () => {
    expect(isFullBleedRoute("/assistant")).toBe(true);
    expect(isFullBleedRoute("/orchestra")).toBe(true);
    expect(isFullBleedRoute("/settings")).toBe(false);
    expect(workspaceRouteOf("/assistant")).toBe("/assistant");
    expect(workspaceRouteOf("/library")).toBeNull();
  });
});

describe("shortcuts and sections", () => {
  it("maps G-sequences to pages (§5.6)", () => {
    expect(GO_SHORTCUTS).toEqual({
      h: "/",
      a: "/assistant",
      o: "/orchestra",
      b: "/builder",
      l: "/library",
      s: "/settings",
    });
  });

  it("lists every page once and every settings section id", () => {
    const hrefs = ALL_NAV_ITEMS.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs).toHaveLength(9);
    expect(SETTINGS_SECTIONS.map((s) => s.id)).toEqual([
      "general",
      "notifications",
      "providers",
      "models",
      "pi",
      "orchestra",
      "github",
      "telegram",
      "app",
    ]);
  });
});
