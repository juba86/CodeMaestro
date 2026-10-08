import { describe, expect, it } from "vitest";
import { GH_RULES, GIT_RULES, SELECTABLE_TOOLS } from "@/lib/assistant/tool-rules";
import { toolLabel } from "@/lib/labels";
import {
  AGENTS,
  APPROVAL_CAPABLE,
  SANDBOX_CAPABLE,
  applyPreset,
  capabilityFields,
  chipPressed,
  commandRulesHint,
  needsAutonomyConsent,
  parseStoredDraft,
  toggleChip,
  toolChips,
  type SessionDraft,
} from "./new-session";

const base: SessionDraft = { provider: "claude", model: "", permissionMode: "default", allowedTools: ["Read"], approvalMode: "off", sandbox: false };

describe("git / GitHub CLI rule groups", () => {
  it("never offers the broad rules that allow any shell command", () => {
    // `git -c alias.x='!sh …' x` and `gh alias set --shell` run anything.
    expect(SELECTABLE_TOOLS).not.toContain("Bash(git *)");
    expect(SELECTABLE_TOOLS).not.toContain("Bash(gh *)");
    for (const r of [...GIT_RULES, ...GH_RULES]) expect(r).toMatch(/^Bash\((git|gh) [a-z]+( [a-z]+)? \*\)$/);
  });

  it("shows each group as one chip that toggles the whole group", () => {
    const chips = toolChips(SELECTABLE_TOOLS, toolLabel);
    expect(chips.map((c) => c.label)).toEqual(["Lesen", "Suchen", "Dateien finden", "Befehl", "Git", "GitHub CLI", "Bearbeiten", "Schreiben", "Websuche", "Web abrufen"]);
    const git = chips.find((c) => c.key === "git")!;
    expect(git.rules).toEqual([...GIT_RULES]);

    const on = toggleChip(["Read"], git, true);
    expect(on).toEqual(["Read", ...GIT_RULES]);
    expect(chipPressed(git, on)).toBe(true);
    expect(chipPressed(git, on.slice(0, -1))).toBe(false);
    expect(toggleChip(on, git, false)).toEqual(["Read"]);
  });

  it("replaces a legacy broad rule when its chip is toggled", () => {
    const git = toolChips(SELECTABLE_TOOLS, toolLabel).find((c) => c.key === "git")!;
    expect(toggleChip(["Read", "Bash(git *)"], git, true)).toEqual(["Read", ...GIT_RULES]);
    expect(toggleChip(["Read", "Bash(git *)"], git, false)).toEqual(["Read"]);
  });

  it("migrates remembered legacy rules to their narrow group", () => {
    const stored = JSON.stringify({ allowedTools: ["Read", "Bash(git *)", "Bash(gh *)", "Bash(rm *)"] });
    expect(parseStoredDraft(stored, [...SELECTABLE_TOOLS], []).allowedTools).toEqual(["Read", ...GIT_RULES, ...GH_RULES]);
  });

  it("treats git/gh rules as changing tools", () => {
    expect(needsAutonomyConsent({ ...base, allowedTools: ["Read", ...GH_RULES] })).toBe(true);
    expect(needsAutonomyConsent({ ...base, allowedTools: ["Read", ...GH_RULES], approvalMode: "all" })).toBe(false);
  });

  it("explains honestly what the groups do not prevent", () => {
    const git = { ...base, allowedTools: ["Read", ...GIT_RULES] };
    expect(commandRulesHint(base)).toBeNull();
    expect(commandRulesHint(git)).toMatch(/Repository-Hooks .* beliebigen Code .* „Dateiänderungen & Befehle“ bestätigst du jeden Befehl\.$/);
    expect(commandRulesHint({ ...git, approvalMode: "all" })).toBeNull();
    expect(commandRulesHint({ ...git, provider: "gemini", approvalMode: "all" })).not.toMatch(/Freigabe/);
    expect(commandRulesHint({ ...git, provider: "pi" })).toBeNull();
  });
});

describe("capabilityFields", () => {
  it("never sends a gate or sandbox the agent cannot honour", () => {
    for (const provider of AGENTS) {
      for (const preset of ["read", "gated", "autonomous"] as const) {
        const draft = { ...applyPreset({ ...base, provider }, preset), approvalMode: "all" as const, sandbox: true };
        const f = capabilityFields(draft);
        if (!APPROVAL_CAPABLE.has(provider)) expect(f.approvalMode, provider).toBe("off");
        if (!SANDBOX_CAPABLE.has(provider)) expect(f.sandbox, provider).toBe(false);
      }
    }
    expect(capabilityFields({ ...base, approvalMode: "edits", sandbox: true })).toEqual({ approvalMode: "edits", sandbox: true });
  });
});
