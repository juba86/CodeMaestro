import { describe, expect, it } from "vitest";
import { defaultOrchestraConfig } from "@/lib/assistant/orchestra-types";
import { EMPTY_ORCHESTRA_LIVE, deriveLiveView, liveSummary, reduceOrchestraLive, type OrchestraLiveState } from "./live";

const fold = (events: object[], start: OrchestraLiveState = EMPTY_ORCHESTRA_LIVE) =>
  events.reduce<OrchestraLiveState>((s, e, i) => reduceOrchestraLive(s, e as { type: string }, 1000 + i * 1000), start);

const plan = {
  type: "plan",
  subtasks: [
    { id: "s1", title: "Struktur entwerfen", workerId: "claude", dependsOn: [], editsFiles: false, roleId: "architekt" },
    { id: "s2", title: "Token-Refresh bauen", workerId: "claude", dependsOn: ["s1"], editsFiles: true, roleId: "coder" },
    { id: "s3", title: "Tests", workerId: "gemini", dependsOn: ["s2"], editsFiles: true, roleId: "tester" },
  ],
  roles: [
    { id: "architekt", name: "Architekt", editsFiles: false },
    { id: "coder", name: "Coder", editsFiles: true },
    { id: "tester", name: "Tester", editsFiles: true },
  ],
};

describe("reduceOrchestraLive", () => {
  it("ignores runs that are not orchestrations and unrelated events", () => {
    expect(reduceOrchestraLive(EMPTY_ORCHESTRA_LIVE, { type: "run_start", kind: "turn" } as { type: string })).toBe(EMPTY_ORCHESTRA_LIVE);
    const s = fold([{ type: "run_start", runId: "r1", kind: "orchestrate", startedAt: 5 }]);
    expect(reduceOrchestraLive(s, { type: "text", content: "x" } as { type: string })).toBe(s);
    expect(s).toMatchObject({ active: true, runId: "r1", startedAt: 5, phase: "planning" });
  });

  it("follows plan → subtasks → review → fix → synthesis → end", () => {
    let s = fold([{ type: "run_start", runId: "r1", kind: "orchestrate" }, plan]);
    expect(s.phase).toBe("distributing");
    expect(s.subtasks.map((x) => x.status)).toEqual(["waiting", "waiting", "waiting"]);

    s = fold(
      [
        { type: "subtask_start", subtaskId: "s1", title: "Struktur entwerfen", workerId: "claude", workerLabel: "Claude Code", roleId: "architekt", roleName: "Architekt" },
        { type: "subtask_text", subtaskId: "s1", content: "…" },
        { type: "subtask_end", subtaskId: "s1", workerLabel: "Claude Code", roleId: "architekt" },
        { type: "subtask_start", subtaskId: "s2", title: "Token-Refresh bauen", workerId: "claude", workerLabel: "Claude Code", roleId: "coder" },
      ],
      s
    );
    expect(s.phase).toBe("coordinating");
    expect(s.subtasks[0].status).toBe("done");
    expect(s.subtasks[1]).toMatchObject({ status: "working", workerLabel: "Claude Code" });
    expect(s.currentSubtaskId).toBe("s2");

    s = fold([{ type: "review_start", subtaskId: "s2", round: 1, reviewerRoleId: "reviewer", reviewerRoleName: "Reviewer", reviewerLabel: "Gemini CLI" }], s);
    expect(s.subtasks[1]).toMatchObject({ status: "review", review: { round: 1, active: true, verdict: null, reviewerRoleId: "reviewer" } });
    const same = reduceOrchestraLive(s, { type: "review_text", subtaskId: "s2", round: 1, content: "x" } as { type: string });
    expect(same).toBe(s);

    s = fold(
      [
        { type: "review_end", subtaskId: "s2", round: 1, verdict: "changes" },
        { type: "subtask_text", subtaskId: "s2", content: "\n\nfix", fixRound: 1 },
      ],
      s
    );
    expect(s.subtasks[1]).toMatchObject({ status: "fixing", fixRound: 1, review: { verdict: "changes", active: false } });

    s = fold(
      [
        { type: "review_start", subtaskId: "s2", round: 2, reviewerRoleId: "reviewer" },
        { type: "review_end", subtaskId: "s2", round: 2, verdict: "pass" },
        { type: "subtask_end", subtaskId: "s2", workerLabel: "Claude Code", roleId: "coder" },
        { type: "subtask_start", subtaskId: "s3", title: "Tests", workerId: "gemini", workerLabel: "Gemini CLI", roleId: "tester" },
        { type: "error", subtaskId: "s3", content: "Gemini CLI fehlgeschlagen" },
        { type: "subtask_end", subtaskId: "s3", roleId: "tester" },
        { type: "synthesis", content: "Zusammenfassung" },
      ],
      s
    );
    expect(s.subtasks.map((x) => x.status)).toEqual(["done", "done", "error"]);
    expect(s.subtasks[2].error).toBe("Gemini CLI fehlgeschlagen");
    expect(s.phase).toBe("synthesizing");
    expect(reduceOrchestraLive(s, { type: "synthesis", content: "more" } as { type: string })).toBe(s);

    s = fold([{ type: "run_end", runId: "r1", status: "idle" }], s);
    expect(s).toMatchObject({ active: false, phase: "done" });
  });

  it("marks running subtasks as stopped on a stopped run", () => {
    const s = fold([
      { type: "run_start", kind: "orchestrate" },
      plan,
      { type: "subtask_start", subtaskId: "s1", roleId: "architekt" },
      { type: "run_end", status: "stopped" },
    ]);
    expect(s.phase).toBe("stopped");
    expect(s.subtasks.map((x) => x.status)).toEqual(["stopped", "waiting", "waiting"]);
  });

  it("builds subtasks from events after a mid-run attach (no plan seen)", () => {
    const s = fold([{ type: "subtask_text", subtaskId: "s9", content: "x" }]);
    expect(s.active).toBe(true);
    expect(s.subtasks[0]).toMatchObject({ id: "s9", status: "working" });
  });
});

describe("deriveLiveView", () => {
  const config = defaultOrchestraConfig();

  it("shows role states, timers, review rounds and the summary", () => {
    let s = fold([{ type: "run_start", kind: "orchestrate" }, plan]);
    let view = deriveLiveView(s, config, 0);
    expect(view.conductor.label).toBe("verteilt 3 Teilaufgaben");
    expect(view.roles.coder).toMatchObject({ status: "waiting", label: "wartet", detail: "wartet auf Architekt" });
    expect(view.roles.reviewer).toMatchObject({ status: "waiting", detail: "prüft danach Coder" });
    expect(view.order).toEqual(["architekt", "coder", "reviewer", "tester"]);

    s = fold([{ type: "subtask_start", subtaskId: "s2", roleId: "coder", workerLabel: "Claude Code" }], s); // at 1000
    view = deriveLiveView(s, config, 43_000);
    expect(view.roles.coder).toMatchObject({ status: "working", label: "arbeitet · 0:42", active: true, detail: "Token-Refresh bauen" });
    expect(view.workingColumns).toEqual(["build"]);
    expect(view.summary).toBe("Coder arbeitet an Teilaufgabe 2/3");

    s = fold([{ type: "review_start", subtaskId: "s2", round: 1, reviewerRoleId: "reviewer", reviewerRoleName: "Reviewer" }], s);
    view = deriveLiveView(s, config, 50_000);
    expect(view.roles.reviewer).toMatchObject({ status: "reviewing", label: "prüft · Runde 1/2", active: true });
    expect(view.roles.coder.label).toBe("wird geprüft · Runde 1/2");
    expect(view.reviewLinks).toEqual(["coder"]);
    expect(view.workingColumns).toEqual(["review"]);
    expect(view.summary).toBe("Reviewer prüft Teilaufgabe 2/3");

    s = fold([{ type: "review_end", subtaskId: "s2", round: 1, verdict: "pass" }, { type: "subtask_end", subtaskId: "s2" }], s);
    view = deriveLiveView(s, config, 60_000);
    expect(view.roles.reviewer).toMatchObject({ status: "passed", label: "passt", tone: "success" });
    expect(view.roles.coder).toMatchObject({ status: "done", label: "fertig", progress: "1/1" });
  });

  it("maps role-less subtasks by worker, else lists them as chosen by the Dirigent", () => {
    const cfg = defaultOrchestraConfig();
    cfg.roles = cfg.roles.map((r) => (r.id === "coder" ? { ...r, workerId: "claude" } : r));
    const s = fold([
      { type: "run_start", kind: "orchestrate" },
      { type: "plan", subtasks: [{ id: "a", title: "A", workerId: "claude" }, { id: "b", title: "B", workerId: "ollama:qwen2.5-coder" }] },
      { type: "subtask_start", subtaskId: "a", workerId: "claude", workerLabel: "Claude Code" },
    ]);
    const view = deriveLiveView(s, cfg, 0);
    expect(view.roles.coder.status).toBe("working");
    expect(view.unassigned).toHaveLength(1);
    expect(view.unassigned[0]).toMatchObject({ roleId: null, detail: "Dirigent wählte ollama:qwen2.5-coder", label: "wartet" });
  });

  it("summarizes conductor phases", () => {
    expect(liveSummary({ ...EMPTY_ORCHESTRA_LIVE, active: true, phase: "planning" })).toBe("Dirigent plant …");
    expect(liveSummary({ ...EMPTY_ORCHESTRA_LIVE, phase: "done" })).toBe("Lauf abgeschlossen");
  });
});
