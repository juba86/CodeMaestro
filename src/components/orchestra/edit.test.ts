import { describe, expect, it } from "vitest";
import { ORCHESTRA_LIMITS, defaultOrchestraConfig, type OrchestraConfig } from "@/lib/assistant/orchestra-types";
import { EXTRA_ROLE_TEMPLATES, columnOf } from "./derive";
import {
  CONDUCTOR_TARGET,
  CUSTOM_ROLE_TEMPLATE,
  addRole,
  canMoveRole,
  canonicalConfig,
  changedRoleNames,
  configsEqual,
  duplicateRole,
  findRole,
  moveRole,
  parseConfig,
  removeRole,
  restoreRole,
  roleSuggestions,
  setReviewLoop,
  setWorker,
  validateRoleName,
} from "./edit";

const base = (): OrchestraConfig => ({ ...defaultOrchestraConfig(), preset: "balanced" });

describe("assignments", () => {
  it("sets workers and marks the config as custom", () => {
    const c = setWorker(base(), "tester", "gemini");
    expect(findRole(c, "tester")!.workerId).toBe("gemini");
    expect(c.preset).toBe("custom");
    const d = setWorker(c, CONDUCTOR_TARGET, "claude");
    expect(d.conductor.workerId).toBe("claude");
  });

  it("leaves the input untouched", () => {
    const c = base();
    const before = canonicalConfig(c);
    setWorker(c, "coder", "x");
    expect(canonicalConfig(c)).toBe(before);
  });
});

describe("names", () => {
  it("rejects empty and duplicate names inline", () => {
    const c = base();
    expect(validateRoleName(c, "coder", "  ")).toBe("Gib der Rolle einen Namen.");
    expect(validateRoleName(c, "coder", "tester")).toBe("Name schon vergeben");
    expect(validateRoleName(c, "coder", "Coder")).toBeNull();
    expect(validateRoleName(c, "coder", "x".repeat(ORCHESTRA_LIMITS.name + 1))).toMatch(/Höchstens/);
  });
});

describe("addRole", () => {
  it("follows the column for „Eigene Rolle …“", () => {
    const plan = addRole(base(), CUSTOM_ROLE_TEMPLATE, "plan")!;
    expect(plan.roleId).toBe("neue-rolle");
    expect(findRole(plan.config, plan.roleId)!.editsFiles).toBe(false);
    expect(plan.column).toBe("plan");
    const build = addRole(plan.config, CUSTOM_ROLE_TEMPLATE, "build")!;
    expect(findRole(build.config, build.roleId)!.name).toBe("Neue Rolle 2");
    expect(build.roleId).toBe("neue-rolle-2");
    expect(build.column).toBe("build");
  });

  it("wires a new Prüfen role as reviewer of the first Umsetzen role without one", () => {
    const r = addRole(base(), EXTRA_ROLE_TEMPLATES[0], "review")!; // Sicherheit, read-only
    expect(r.reviews).toBe("tester"); // coder already has the reviewer
    expect(findRole(r.config, "tester")!.reviewLoop).toMatchObject({ enabled: true, reviewerRoleId: "sicherheit" });
    expect(r.column).toBe("review");
    expect(columnOf(findRole(r.config, "sicherheit")!, r.config)).toBe("review");
  });

  it("keeps a suggestion's own capability", () => {
    const r = addRole(base(), EXTRA_ROLE_TEMPLATES[1], "plan")!; // Frontend edits files
    expect(r.column).toBe("build");
  });

  it("stops at the role limit", () => {
    let c = base();
    while (c.roles.length < ORCHESTRA_LIMITS.roles) c = addRole(c, CUSTOM_ROLE_TEMPLATE, "plan")!.config;
    expect(addRole(c, CUSTOM_ROLE_TEMPLATE, "plan")).toBeNull();
    expect(duplicateRole(c, "coder")).toBeNull();
  });

  it("suggests missing defaults and extras", () => {
    const c = base();
    c.roles = c.roles.filter((r) => r.id !== "doku");
    expect(roleSuggestions(c, EXTRA_ROLE_TEMPLATES).map((t) => t.name)).toEqual(["Doku", "Sicherheit", "Frontend", "Datenbank"]);
  });
});

describe("remove / restore", () => {
  it("switches off loops pointing to the removed role and restores them on undo", () => {
    const c = base();
    const removed = removeRole(c, "reviewer")!;
    expect(findRole(removed.config, "reviewer")).toBeUndefined();
    expect(findRole(removed.config, "coder")!.reviewLoop.enabled).toBe(false);
    expect(removed.removal.loopsOff).toEqual(["coder"]);
    const restored = restoreRole(removed.config, removed.removal)!;
    expect(restored.roles.map((r) => r.id)).toEqual(c.roles.map((r) => r.id));
    expect(findRole(restored, "coder")!.reviewLoop.enabled).toBe(true);
  });

  it("does not restore over a role that took the id meanwhile", () => {
    const removed = removeRole(base(), "doku")!;
    const taken = addRole(removed.config, { ...CUSTOM_ROLE_TEMPLATE, id: "doku", name: "Doku" }, "build")!;
    expect(restoreRole(taken.config, removed.removal)).toBeNull();
  });
});

describe("duplicate and move", () => {
  it("duplicates right after the original with a new slug", () => {
    const d = duplicateRole(base(), "coder")!;
    expect(d.roleId).toBe("coder-2");
    const ids = d.config.roles.map((r) => r.id);
    expect(ids.indexOf("coder-2")).toBe(ids.indexOf("coder") + 1);
    expect(findRole(d.config, "coder-2")!.name).toBe("Coder 2");
  });

  it("moves within the column, skipping roles of other columns", () => {
    const c = base(); // order: architekt, coder, reviewer, tester, recherche, doku
    expect(canMoveRole(c, "architekt", -1)).toBe(false);
    const moved = moveRole(c, "recherche", -1); // plan column: architekt, recherche
    expect(moved.roles.map((r) => r.id).slice(0, 1)).toEqual(["recherche"]);
    expect(moveRole(c, "tester", -1).roles.map((r) => r.id)).toEqual(["architekt", "tester", "reviewer", "coder", "recherche", "doku"]);
    expect(moveRole(c, "reviewer", 1)).toBe(c);
  });
});

describe("review loop", () => {
  it("picks a reviewer when switching a loop on", () => {
    const c = setReviewLoop(base(), "tester", { enabled: true });
    expect(findRole(c, "tester")!.reviewLoop).toMatchObject({ enabled: true, reviewerRoleId: "reviewer" });
    const self = setReviewLoop({ ...c, roles: c.roles.map((r) => (r.id === "architekt" ? { ...r, reviewLoop: { ...r.reviewLoop, reviewerRoleId: "architekt" } } : r)) }, "architekt", { enabled: true });
    expect(findRole(self, "architekt")!.reviewLoop.reviewerRoleId).toBe("reviewer");
    const rounds = setReviewLoop(c, "tester", { maxRounds: 9 });
    expect(findRole(rounds, "tester")!.reviewLoop.maxRounds).toBe(3);
  });
});

describe("comparison and drafts", () => {
  it("compares independent of key order", () => {
    const a = base();
    const b = JSON.parse(JSON.stringify({ preset: a.preset, roles: a.roles, conductor: a.conductor, version: 1 }));
    expect(configsEqual(a, b)).toBe(true);
    expect(configsEqual(a, setWorker(a, "coder", "x"))).toBe(false);
  });

  it("names what changed", () => {
    const a = base();
    let b = setWorker(a, "tester", "gemini");
    b = setWorker(b, CONDUCTOR_TARGET, "claude");
    b = removeRole(b, "doku")!.config;
    expect(changedRoleNames(a, b)).toEqual(["Dirigent", "Tester", "Doku"]);
  });

  it("parses stored drafts defensively", () => {
    const a = base();
    expect(configsEqual(parseConfig(JSON.parse(JSON.stringify(a))), a)).toBe(true);
    expect(parseConfig(null)).toBeNull();
    expect(parseConfig({ ...a, roles: [{ ...a.roles[0], id: "Bad Id" }] })).toBeNull();
    expect(parseConfig({ ...a, roles: [{ ...a.roles[0], editsFiles: "yes" }] })).toBeNull();
    expect(parseConfig({ ...a, preset: "weird" })!.preset).toBe("custom");
  });
});
