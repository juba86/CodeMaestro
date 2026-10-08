import { describe, expect, it } from "vitest";
import { buildPreference, composerPlaceholder, formatBytes, loopBody, loopChipLabel, sendBlockedReason } from "./composer-logic";
import {
  applyPreset,
  capabilityNote,
  draftSummary,
  matchPreset,
  needsAutonomyConsent,
  parseStoredDraft,
  presetDisabledReason,
  switchAgent,
  toolChipLabel,
  ungatedWarning,
  type SessionDraft,
} from "./new-session";
import { filterSessions, folderName, groupSessions, neighbourSession, recentFolders, shortPath } from "./session-list";
import {
  EMPTY_ANSWER,
  addHintPreset,
  answerReason,
  chooseOption,
  chooseOther,
  openQuestionsReason,
  planReviseReason,
  setOtherText,
} from "./question-logic";
import { DEFAULT_LOOP_OPTIONS, type ApprovalEvent, type SessionSummary } from "./types";

const base: SessionDraft = { provider: "claude", model: "", permissionMode: "default", allowedTools: ["Read"], approvalMode: "off", sandbox: false };

describe("new session presets", () => {
  it("applies and recognises the presets", () => {
    const gated = applyPreset(base, "gated");
    expect(gated).toMatchObject({ approvalMode: "all", sandbox: true, allowedTools: ["Read", "Grep", "Glob", "Edit", "Write", "Bash"] });
    expect(matchPreset(gated)).toBe("gated");
    expect(matchPreset(applyPreset(base, "read"))).toBe("read");
    expect(matchPreset(applyPreset(base, "autonomous"))).toBe("autonomous");
    expect(matchPreset({ ...gated, allowedTools: [...gated.allowedTools, "WebFetch"] })).toBeNull();
  });

  it("honours agent capabilities", () => {
    expect(presetDisabledReason("gated", "gemini")).toBe("Freigabe-Gate nur mit Claude Code oder pi.");
    expect(presetDisabledReason("gated", "pi")).toBeNull();
    expect(applyPreset({ ...base, provider: "pi" }, "gated")).toMatchObject({ approvalMode: "all", sandbox: false });
    expect(capabilityNote("claude")).toBe("Dateien ändern ✓ · Freigabe & Sandbox ✓");
    expect(capabilityNote("gemini")).toBe("Dateien ändern ✓ · ohne Freigabe-Gate");
  });

  it("switches agents without keeping settings the agent cannot honour", () => {
    const gated = applyPreset(base, "gated");
    const gemini = switchAgent({ ...gated, model: "opus" }, "gemini");
    expect(gemini).toMatchObject({ provider: "gemini", model: "opus", approvalMode: "off", sandbox: false, allowedTools: ["Read", "Grep", "Glob"] });
    const pi = switchAgent({ ...gated, model: "opus" }, "pi");
    expect(pi).toMatchObject({ provider: "pi", model: "", approvalMode: "all", sandbox: false });
  });

  it("warns about ungated changes and needs consent for autonomy", () => {
    expect(ungatedWarning(applyPreset(base, "gated"))).toBeNull();
    expect(ungatedWarning(applyPreset(base, "read"))).toBeNull();
    expect(ungatedWarning(applyPreset(base, "autonomous"))).toBe("Ohne Freigabe ändert der Agent Dateien und führt Befehle direkt aus.");
    expect(ungatedWarning({ ...applyPreset(base, "gated"), approvalMode: "edits" })).toMatch(/^Befehle laufen ohne Rückfrage/);
    expect(needsAutonomyConsent(applyPreset(base, "autonomous"))).toBe(true);
    expect(needsAutonomyConsent(applyPreset(base, "gated"))).toBe(false);
    // Without a gate-capable agent, any changing tool needs consent.
    expect(needsAutonomyConsent({ ...base, provider: "gemini", allowedTools: ["Edit"], approvalMode: "all" })).toBe(true);
  });

  it("summarises and labels", () => {
    expect(draftSummary("CodeMaestro", applyPreset(base, "gated"))).toBe("CodeMaestro · Claude Code · Bearbeiten mit Freigabe");
    expect(draftSummary("", { ...base, allowedTools: ["Read", "WebFetch"] })).toBe("Claude Code · Eigene Einstellungen");
    const id = (t: string) => t;
    expect(toolChipLabel("Bash(git *)", id)).toBe("Git");
    expect(toolChipLabel("Bash(gh *)", id)).toBe("GitHub CLI");
    expect(toolChipLabel("Read", () => "Lesen")).toBe("Lesen");
  });

  it("reads remembered settings defensively", () => {
    const tools = ["Read", "Edit"];
    expect(parseStoredDraft("nope", tools, [])).toEqual({});
    expect(
      parseStoredDraft(
        JSON.stringify({ provider: "evil", model: "m", allowedTools: ["Read", "Rm"], approvalMode: "maybe", sandbox: true, permissionMode: "plan", cwd: "/p" }),
        tools,
        ["default", "plan"],
      ),
    ).toEqual({ model: "m", allowedTools: ["Read"], sandbox: true, permissionMode: "plan", cwd: "/p" });
  });
});

describe("composer logic", () => {
  it("normalises loop options and labels the chip", () => {
    expect(loopBody({ ...DEFAULT_LOOP_OPTIONS, maxIterations: 0, completionPromise: "  " })).toMatchObject({ maxIterations: 10, completionPromise: "DONE" });
    expect(loopBody({ ...DEFAULT_LOOP_OPTIONS, maxIterations: 500 }).maxIterations).toBe(100);
    expect(loopChipLabel({ ...DEFAULT_LOOP_OPTIONS, maxIterations: 4, completionPromise: "FERTIG" })).toBe("Loop · 4× · FERTIG");
  });

  it("turns the project context into a preference", () => {
    expect(buildPreference({ stack: "", constraints: "", routing: "balanced", verify: false })).toBe("");
    expect(buildPreference({ stack: "Next.js", constraints: "keine neuen Deps", routing: "local", verify: true })).toBe(
      "Stack/Sprache: Next.js. Rahmenbedingungen/No-Gos: keine neuen Deps. Bevorzuge lokale/günstige Modelle, wo die Qualität es zulässt. Füge eine abschließende Verifikations-/Test-Teilaufgabe hinzu.",
    );
  });

  it("explains why sending is blocked", () => {
    const ok = { text: "x", running: false, offline: false, busy: false, hasSession: true };
    expect(sendBlockedReason(ok)).toBeNull();
    expect(sendBlockedReason({ ...ok, text: " " })).toBe("Erst eine Nachricht eingeben.");
    expect(sendBlockedReason({ ...ok, offline: true })).toBe("Offline – Nachricht wird nicht gesendet");
    expect(sendBlockedReason({ ...ok, running: true })).toMatch(/^Der Agent arbeitet noch/);
    expect(composerPlaceholder({ mode: "chat", running: false, offline: false })).toBe("Nachricht an den Agenten …");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(14_000)).toBe("14 KB");
    expect(formatBytes(3_355_443)).toBe("3,2 MB");
  });
});

describe("session list", () => {
  const now = new Date(2026, 9, 7, 15, 0).getTime(); // Wednesday
  const s = (id: string, updated: Date, extra: Partial<SessionSummary> = {}): SessionSummary => ({
    id,
    provider: "claude",
    model: "",
    title: `Session ${id}`,
    cwd: `/home/u/${id}`,
    status: "idle",
    totalCostUsd: 0,
    messageCount: 1,
    updatedAt: updated.toISOString(),
    ...extra,
  });
  const sessions = [
    s("a", new Date(2026, 9, 7, 9)),
    s("b", new Date(2026, 9, 5, 9)), // Monday this week
    s("c", new Date(2026, 9, 1, 9)),
    s("d", new Date(2026, 9, 6, 9), { status: "running" }),
    s("e", new Date(2026, 9, 7, 14)),
  ];
  const activity = { active: new Set(["d"]), waiting: new Set(["e"]) };

  it("groups into Aktiv · Heute · Diese Woche · Älter", () => {
    expect(groupSessions(sessions, activity, now).map((g) => [g.label, g.sessions.map((x) => x.id)])).toEqual([
      ["Aktiv", ["e", "d"]],
      ["Heute", ["a"]],
      ["Diese Woche", ["b"]],
      ["Älter", ["c"]],
    ]);
  });

  it("filters and searches", () => {
    expect(filterSessions(sessions, "active", "", activity).map((x) => x.id)).toEqual(["d", "e"]);
    expect(filterSessions(sessions, "waiting", "", activity).map((x) => x.id)).toEqual(["e"]);
    expect(filterSessions(sessions, "all", "/home/u/c", activity).map((x) => x.id)).toEqual(["c"]);
    expect(filterSessions(sessions, "all", "SESSION B", activity).map((x) => x.id)).toEqual(["b"]);
  });

  it("walks the list for J/K and lists recent folders", () => {
    expect(neighbourSession(["a", "b", "c"], "b", 1)).toBe("c");
    expect(neighbourSession(["a", "b", "c"], "c", 1)).toBe("a");
    expect(neighbourSession(["a", "b", "c"], null, -1)).toBe("c");
    expect(neighbourSession([], null, 1)).toBeNull();
    expect(recentFolders(sessions, 2)).toEqual(["/home/u/e", "/home/u/a"]);
    expect(folderName("/home/u/proj/")).toBe("proj");
    expect(shortPath("/home/u/eigene Apps/CodeMaestro")).toBe("~/eigene Apps/CodeMaestro");
    expect(shortPath("/srv/x")).toBe("/srv/x");
  });
});

describe("question answers", () => {
  const card: ApprovalEvent = {
    type: "question_request",
    approvalId: "q",
    kind: "ask",
    questions: [
      { header: "Stack", question: "Welcher?", options: [{ label: "React" }, { label: "Vue" }] },
      { question: "Welche Tests?", multiSelect: true, options: [{ label: "Unit" }, { label: "E2E" }] },
      { question: "Name?", options: [] },
    ],
  };

  it("counts open questions until every one is answered", () => {
    let s = EMPTY_ANSWER;
    expect(openQuestionsReason(card, s)).toBe("Noch 3 Fragen offen");
    s = chooseOption(s, 0, "React", false);
    s = chooseOption(s, 0, "Vue", false);
    s = chooseOption(s, 1, "Unit", true);
    s = chooseOption(s, 1, "E2E", true);
    expect(openQuestionsReason(card, s)).toBe("Noch 1 Frage offen");
    s = setOtherText(s, 2, "CodeMaestro");
    expect(openQuestionsReason(card, s)).toBeNull();
    expect(answerReason(card, s)).toBe("Der Nutzer hat geantwortet:\n- Stack: Vue\n- Welche Tests?: Unit, E2E\n- Name?: CodeMaestro");
  });

  it("uses the own answer only when chosen for questions with options", () => {
    let s = setOtherText(EMPTY_ANSWER, 0, "Svelte");
    expect(answerReason(card, s).split("\n")[1]).toBe("- Stack: ");
    s = chooseOther(s, 0, false);
    expect(answerReason(card, s).split("\n")[1]).toBe("- Stack: Svelte");
    // Picking an option again turns the own answer off (single select).
    s = chooseOption(s, 0, "React", false);
    expect(answerReason(card, s).split("\n")[1]).toBe("- Stack: React");
  });

  it("builds hints", () => {
    expect(addHintPreset("", "A.")).toBe("A.");
    expect(addHintPreset("x ", "A.")).toBe("x\nA.");
    expect(addHintPreset("x\nA.", "A.")).toBe("x\nA.");
    expect(planReviseReason("  ")).toMatch(/^Der Nutzer hat den Plan abgelehnt/);
    expect(planReviseReason("kürzer")).toBe("Der Nutzer möchte den Plan überarbeitet haben: kürzer");
  });
});
