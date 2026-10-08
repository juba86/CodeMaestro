import { describe, expect, it } from "vitest";
import { createAssistantSessionSchema } from "@/lib/validation/schemas";
import { PERMISSION_MODES, SELECTABLE_TOOLS } from "@/lib/assistant/security";
import { TOOL_GROUPS, toolGroupOf } from "@/lib/assistant/tool-rules";
import {
  APPROVAL_MODE_LABEL,
  NAV_LABEL,
  PERMISSION_MODE_LABEL,
  PROVIDER_LABEL,
  RUN_KIND_LABEL,
  RUN_ORIGIN_LABEL,
  TOOL_GROUP_LABEL,
  TOOL_LABEL,
  approvalModeLabel,
  humanize,
  permissionModeLabel,
  providerLabel,
  runKindLabel,
  runOriginLabel,
  toolLabel,
} from "./labels";

const shape = createAssistantSessionSchema.shape;
const enumValues = (s: { unwrap(): { unwrap(): { options: readonly string[] } } }) => [...s.unwrap().unwrap().options];

describe("label maps cover every value the app stores", () => {
  it("permission modes (security.ts + session schema)", () => {
    for (const m of [...PERMISSION_MODES, ...enumValues(shape.permissionMode)]) {
      expect(PERMISSION_MODE_LABEL[m], m).toBeTruthy();
    }
  });

  it("approval modes", () => {
    for (const m of enumValues(shape.approvalMode)) expect(APPROVAL_MODE_LABEL[m], m).toBeTruthy();
  });

  it("assistant providers", () => {
    for (const p of enumValues(shape.provider)) expect(PROVIDER_LABEL[p], p).toBeTruthy();
  });

  it("selectable tools (git/gh rules are labelled by their chip group)", () => {
    for (const t of SELECTABLE_TOOLS) {
      const group = toolGroupOf(t);
      expect(group ? TOOL_GROUP_LABEL[group.id] : TOOL_LABEL[t], t).toBeTruthy();
    }
    // Legacy rules stored by older sessions read like their chip.
    for (const g of TOOL_GROUPS) expect(TOOL_LABEL[g.legacy]).toBe(TOOL_GROUP_LABEL[g.id]);
  });

  it("the full tool selection fits the session schema", () => {
    expect(shape.allowedTools.safeParse(SELECTABLE_TOOLS.join(",")).success).toBe(true);
  });

  it("run kinds, origins and navigation", () => {
    expect(Object.keys(RUN_KIND_LABEL)).toEqual(["turn", "orchestrate", "loop"]);
    expect(Object.keys(RUN_ORIGIN_LABEL)).toEqual(["pwa", "telegram"]);
    for (const path of ["/", "/assistant", "/orchestra", "/builder", "/library", "/templates", "/playground", "/knowledge", "/settings"]) {
      expect(NAV_LABEL[path], path).toBeTruthy();
    }
  });
});

describe("label functions", () => {
  it("translate known values", () => {
    expect(providerLabel("claude")).toBe("Claude Code");
    expect(providerLabel("pi")).toBe("pi · lokale Modelle");
    expect(permissionModeLabel("bypassPermissions")).toBe("Ohne Rückfrage (gefährlich)");
    expect(permissionModeLabel("default")).toBe("Nachfragen");
    expect(approvalModeLabel("off")).toBe("Aus – direkt ausführen");
    expect(approvalModeLabel("all")).toBe("Dateiänderungen & Befehle");
    expect(toolLabel("Bash")).toBe("Befehl");
    expect(toolLabel("MultiEdit")).toBe("Bearbeiten");
    expect(runKindLabel("orchestrate")).toBe("Orchester");
    expect(runOriginLabel("telegram")).toBe("via Telegram");
  });

  it("maps pi's lower-case tool names", () => {
    expect(toolLabel("read")).toBe("Lesen");
    expect(toolLabel("find")).toBe("Dateien finden");
    expect(toolLabel("bash")).toBe("Befehl");
  });

  it("fall back to the capitalised raw value", () => {
    expect(providerLabel("ollama")).toBe("Ollama");
    expect(toolLabel("mcp__github__create_issue")).toBe("Mcp__github__create_issue");
    expect(permissionModeLabel("custom")).toBe("Custom");
    expect(approvalModeLabel("Strict")).toBe("Strict");
  });

  it("never return an empty string", () => {
    for (const fn of [providerLabel, toolLabel, permissionModeLabel, approvalModeLabel, runKindLabel, runOriginLabel]) {
      expect(fn("")).toBe("Unbekannt");
      expect(fn(undefined)).toBe("Unbekannt");
      expect(fn(null)).toBe("Unbekannt");
    }
    expect(humanize("  ")).toBe("Unbekannt");
  });

  it("ignore inherited object keys", () => {
    expect(providerLabel("toString")).toBe("ToString");
    expect(toolLabel("constructor")).toBe("Constructor");
  });
});
