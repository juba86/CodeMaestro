import { describe, expect, it } from "vitest";
import { GH_RULES, GIT_RULES, SELECTABLE_TOOLS } from "@/lib/assistant/tool-rules";
import { toolLabel } from "@/lib/labels";
import {
  AGENTS,
  APPROVAL_CAPABLE,
  NEW_CONVERSATION,
  SANDBOX_CAPABLE,
  alreadyLinkedSessionId,
  applyPreset,
  capabilityFields,
  chipPressed,
  commandRulesHint,
  conversationAction,
  conversationChoice,
  conversationTitle,
  conversationsUrl,
  needsAutonomyConsent,
  offersResume,
  parseConversations,
  parseStoredDraft,
  resumeFields,
  startLabel,
  toggleChip,
  toolChips,
  visibleConversations,
  type ClaudeConversation,
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

describe("Projekt fortsetzen (Claude Code conversations)", () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const conv = (n: number, extra: Partial<ClaudeConversation> = {}): ClaudeConversation => ({
    id: id(n),
    title: `Thema ${n}`,
    updatedAt: new Date(Date.UTC(2026, 9, 8) - n * 60_000).toISOString(),
    ...extra,
  });
  const list = [conv(1), conv(2, { linkedSessionId: "cm2" }), conv(3), conv(4), conv(5)];

  it("is offered for Claude Code with a chosen folder only", () => {
    expect(offersResume("claude", "/w/app")).toBe(true);
    expect(offersResume("claude", " ")).toBe(false);
    for (const a of AGENTS.filter((x) => x !== "claude")) expect(offersResume(a, "/w/app"), a).toBe(false);
    expect(conversationsUrl("/w/my app")).toBe("/api/assistant/claude-sessions?cwd=%2Fw%2Fmy%20app");
  });

  it("parses the list defensively, newest first", () => {
    const parsed = parseConversations({
      sessions: [
        conv(3),
        { ...conv(1), linkedSessionId: "", messageCount: 4 },
        conv(1), // duplicate
        { id: "../x", title: "t", updatedAt: conv(2).updatedAt },
        { id: id(9), title: 5, updatedAt: "nie" },
        { id: id(8), updatedAt: conv(8).updatedAt },
        null,
      ],
    });
    expect(parsed.map((c) => c.id)).toEqual([id(1), id(3), id(8)]);
    expect(parsed[0]).toEqual({ ...conv(1), messageCount: 4 });
    expect(parsed[2].title).toBe("");
    expect(conversationTitle(parsed[2])).toBe("Ohne Titel");
    expect(parseConversations(null)).toEqual([]);
    expect(parseConversations({ sessions: "x" })).toEqual([]);
  });

  it("preselects the most recent conversation and keeps the user's pick per folder", () => {
    expect(conversationChoice(null, "/a", list)).toBe(id(1));
    expect(conversationChoice(null, "/a", [])).toBe(NEW_CONVERSATION);
    expect(conversationChoice({ cwd: "/a", id: id(3) }, "/a", list)).toBe(id(3));
    expect(conversationChoice({ cwd: "/a", id: NEW_CONVERSATION }, "/a", list)).toBe(NEW_CONVERSATION);
    // Another folder, or a pick that is no longer listed: back to the default.
    expect(conversationChoice({ cwd: "/b", id: NEW_CONVERSATION }, "/a", list)).toBe(id(1));
    expect(conversationChoice({ cwd: "/a", id: id(42) }, "/a", list)).toBe(id(1));
  });

  it("resumes an unlinked conversation, opens a linked one, else starts fresh", () => {
    const resume = conversationAction("claude", id(1), list);
    expect(resume).toEqual({ kind: "resume", conversation: list[0] });
    expect(resumeFields(resume)).toEqual({ resumeSessionId: id(1) });
    expect(startLabel(resume)).toBe("Unterhaltung fortsetzen");

    const open = conversationAction("claude", id(2), list);
    expect(open).toEqual({ kind: "open", sessionId: "cm2", conversation: list[1] });
    expect(resumeFields(open)).toEqual({});
    expect(startLabel(open)).toBe("Session öffnen");

    for (const action of [
      conversationAction("claude", NEW_CONVERSATION, list),
      conversationAction("claude", id(42), list),
      conversationAction("codex", id(1), list), // never resumes for other agents
    ]) {
      expect(action).toEqual({ kind: "new" });
      expect(resumeFields(action)).toEqual({});
      expect(startLabel(action)).toBe("Session starten");
    }
  });

  it("shows the newest few rows and never hides the selected one", () => {
    expect(visibleConversations(list, id(1), false).map((c) => c.id)).toEqual([id(1), id(2), id(3)]);
    expect(visibleConversations(list, id(5), false).map((c) => c.id)).toEqual([id(1), id(2), id(3), id(5)]);
    expect(visibleConversations(list, NEW_CONVERSATION, true)).toHaveLength(5);
    expect(visibleConversations(list.slice(0, 2), id(1), false)).toHaveLength(2);
  });

  it("recognises the server's 409 ALREADY_LINKED answer", () => {
    expect(alreadyLinkedSessionId(409, { code: "ALREADY_LINKED", sessionId: "cm1", error: "x" })).toBe("cm1");
    expect(alreadyLinkedSessionId(409, { code: "OTHER", sessionId: "cm1" })).toBeNull();
    expect(alreadyLinkedSessionId(400, { code: "ALREADY_LINKED", sessionId: "cm1" })).toBeNull();
    expect(alreadyLinkedSessionId(409, { code: "ALREADY_LINKED" })).toBeNull();
    expect(alreadyLinkedSessionId(409, null)).toBeNull();
  });
});
