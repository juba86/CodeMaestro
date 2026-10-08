import { describe, expect, it } from "vitest";
import { NO_MODEL_WARNING, defaultOrchestraConfig, type OrchestraConfig, type OrchestraWorkerInfo } from "@/lib/assistant/orchestra-types";
import { CONDUCTOR_TARGET, findRole, setWorker, updateRole } from "./edit";
import { countProblems, deriveProblems, problemBadgeText, problemsFor, saveBlockedReason } from "./problems";

const claude: OrchestraWorkerInfo = { id: "claude", kind: "claude-cli", label: "Claude Code", editsFiles: true, local: false, model: "" };
const gemini: OrchestraWorkerInfo = { id: "gemini", kind: "gemini-cli", label: "Gemini CLI", editsFiles: true, local: false, model: "" };
const mini: OrchestraWorkerInfo = { id: "api:openai", kind: "api", label: "API: OpenAI", editsFiles: false, local: false, model: "gpt-5-mini" };
const qwen: OrchestraWorkerInfo = { id: "ollama:qwen3:14b", kind: "ollama", label: "Local: qwen3:14b", editsFiles: false, local: true, model: "qwen3:14b" };

const cfg = (): OrchestraConfig => defaultOrchestraConfig();
const ids = (c: OrchestraConfig, w: OrchestraWorkerInfo[] | null) => deriveProblems(c, w).map((p) => `${p.severity}:${p.id}`);

describe("deriveProblems", () => {
  it("errors only for what the PUT rejects plus duplicate names", () => {
    let c = updateRole(cfg(), "coder", { name: " " });
    c = updateRole(c, "tester", { name: "reviewer" });
    const problems = deriveProblems(c, [claude]);
    const errors = problems.filter((p) => p.severity === "error");
    expect(errors.map((p) => p.id)).toEqual(["name-empty:coder", "name-dup:tester"]);
    expect(errors[0].message).toBe("Gib der Rolle einen Namen.");
    expect(errors[1].message).toBe("Name schon vergeben.");
    expect(saveBlockedReason(countProblems(problems))).toBe("Erst 2 Probleme beheben");
  });

  it("flags a text-only model on a file-editing role with fixes", () => {
    const c = setWorker(cfg(), "tester", mini.id);
    const p = deriveProblems(c, [claude, gemini, mini]).find((x) => x.id === "capability:tester")!;
    expect(p.severity).toBe("warning");
    expect(p.capability).toBe(true);
    expect(p.message).toBe("‚Tester‘ soll Dateien ändern, aber gpt-5-mini liefert nur Text.");
    expect(p.fixes.map((f) => f.label)).toEqual(["Claude Code nehmen", "Nur lesen lassen"]);
    expect(findRole(p.fixes[0].apply(c), "tester")!.workerId).toBe("claude");
    expect(findRole(p.fixes[1].apply(c), "tester")!.editsFiles).toBe(false);
  });

  it("warns when Auto finds no file-capable model", () => {
    const p = deriveProblems(cfg(), [qwen]).filter((x) => x.id.startsWith("no-file-worker:"));
    expect(p.map((x) => x.roleId)).toEqual(["coder", "tester"]);
    expect(p[0].message).toBe("Kein Modell mit Dateizugriff verfügbar – ‚Coder‘ liefert nur Text.");
  });

  it("reports unavailable models for roles and the Dirigent", () => {
    let c = setWorker(cfg(), "architekt", "ollama:gone");
    c = setWorker(c, CONDUCTOR_TARGET, "gone");
    const problems = deriveProblems(c, [claude]);
    const role = problems.find((p) => p.id === "model-unavailable:architekt")!;
    expect(role.message).toBe("Modell ‚ollama:gone‘ ist nicht verfügbar – Automatisch wird verwendet.");
    expect(role.fixes.map((f) => f.label)).toEqual(["Automatisch", "Modell wählen"]);
    expect(findRole(role.fixes[0].apply(c), "architekt")!.workerId).toBe("");
    expect(role.fixes[1].intent).toBe("pick-model");
    expect(problemsFor(problems, CONDUCTOR_TARGET).map((p) => p.id)).toEqual(["conductor-unavailable"]);
  });

  it("checks Prüfschleifen", () => {
    let c = updateRole(cfg(), "reviewer", { enabled: false });
    expect(ids(c, null)).toContain("warning:loop-disabled:coder");
    const p = deriveProblems(c, null).find((x) => x.id === "loop-disabled:coder")!;
    expect(p.message).toBe("Reviewer ‚Reviewer‘ ist deaktiviert – die Prüfschleife wird übersprungen.");
    expect(findRole(p.fixes[1].apply(c), "reviewer")!.enabled).toBe(true);
    c = updateRole(cfg(), "coder", { reviewLoop: { reviewerRoleId: "coder" } });
    expect(deriveProblems(c, null).find((x) => x.id === "loop-self:coder")!.message).toBe("‚Coder‘ kann sich nicht selbst prüfen.");
    c = updateRole(cfg(), "coder", { reviewLoop: { reviewerRoleId: "weg" } });
    const missing = deriveProblems(c, null).find((x) => x.id === "loop-missing:coder")!;
    expect(findRole(missing.fixes[0].apply(c), "coder")!.reviewLoop.enabled).toBe(false);
  });

  it("warns about no enabled role and no workers", () => {
    const c = cfg();
    c.roles = c.roles.map((r) => ({ ...r, enabled: false }));
    const problems = deriveProblems(c, []);
    expect(problems.map((p) => p.id)).toEqual(["no-enabled-role", "no-workers"]);
    expect(problems[1].message).toBe(NO_MODEL_WARNING);
    expect(problems[0].fixes[0].apply(c).roles.every((r) => r.enabled)).toBe(true);
    const none = deriveProblems({ ...c, roles: [] }, null);
    expect(none[0].fixes[0].intent).toBe("add-role");
  });

  it("adds uncounted infos for Auto and same-model reviews", () => {
    const problems = deriveProblems(cfg(), [claude, gemini]);
    const counts = countProblems(problems);
    expect(counts.errors + counts.warnings).toBe(0);
    expect(problemBadgeText(counts)).toBeNull();
    const auto = problems.find((p) => p.id === "auto:tester")!;
    expect(auto.message).toBe("Automatisch – gewählt wird beim Start: Claude Code.");
    const same = problems.find((p) => p.id === "same-model:coder")!;
    expect(same.roleId).toBe("reviewer");
    expect(same.message).toBe("Reviewer und Coder nutzen dasselbe Modell – eine zweite Meinung prüft wirksamer.");
    expect(same.fixes.map((f) => f.label)).toEqual(["Gemini CLI nehmen"]);
    expect(findRole(same.fixes[0].apply(cfg()), "reviewer")!.workerId).toBe("gemini");
  });

  it("skips model checks while the worker list is unknown", () => {
    const c = setWorker(cfg(), "tester", "whatever");
    expect(deriveProblems(c, null)).toEqual([]);
  });

  it("formats the header badge", () => {
    expect(problemBadgeText({ errors: 1, warnings: 3, infos: 0 })).toMatchObject({ tone: "danger", text: "1 Problem" });
    expect(problemBadgeText({ errors: 0, warnings: 2, infos: 4 })).toMatchObject({ tone: "warning", text: "2 Hinweise" });
    expect(saveBlockedReason({ errors: 1, warnings: 0, infos: 0 })).toBe("Erst 1 Problem beheben");
  });
});
