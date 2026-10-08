import { describe, expect, it } from "vitest";
import { EMPTY_LIVE, liveReducer, pendingCards, runningLabel, stateAnnouncement, type LiveState } from "./run-events";
import { metaOf } from "./meta";
import type { ApprovalEvent, RunEvent } from "./types";

const fold = (events: RunEvent[], start: LiveState = EMPTY_LIVE) =>
  events.reduce((s, event) => liveReducer(s, { type: "event", event }), start);

const run = { runId: "run_1", kind: "turn" as const, origin: "pwa" as const, startedAt: 1 };
const approval: ApprovalEvent = { type: "approval_request", approvalId: "apr_1", tool: "Bash", command: "ls", expiresAt: 10 };
const question: ApprovalEvent = { type: "question_request", approvalId: "apr_2", tool: "AskUserQuestion", kind: "ask", questions: [] };

describe("liveReducer", () => {
  it("merges text into one segment until a tool call interrupts it", () => {
    const s = fold([
      { type: "run_start", ...run },
      { type: "text", content: "Hal" },
      { type: "text", content: "lo" },
      { type: "tool_use", name: "Read", input: { file_path: "a" }, toolUseId: "t1" },
      { type: "tool_result", toolUseId: "t1", content: "x" },
      { type: "text", content: "Fertig" },
    ]);
    expect(s.run?.runId).toBe("run_1");
    expect(s.items.map((m) => [m.role, m.content])).toEqual([
      ["assistant", "Hallo"],
      ["tool_use", "Read"],
      ["tool_result", "x"],
      ["assistant", "Fertig"],
    ]);
  });

  it("does not mutate previous state (replay-safe)", () => {
    const a = fold([{ type: "text", content: "a" }]);
    const b = liveReducer(a, { type: "event", event: { type: "text", content: "b" } });
    expect(a.items[0].content).toBe("a");
    expect(b.items[0].content).toBe("ab");
  });

  it("merges thinking per turn into one item", () => {
    const s = fold([
      { type: "thinking", content: "1" },
      { type: "text", content: "t" },
      { type: "thinking", content: "2" },
      { type: "init" },
      { type: "thinking", content: "3" },
    ]);
    expect(s.items.filter((m) => m.role === "thinking").map((m) => m.content)).toEqual(["1\n\n2", "3"]);
  });

  it("dedupes seeded cards against the replay and removes resolved ones", () => {
    let s = liveReducer(EMPTY_LIVE, { type: "seed", run, pending: [approval, question] });
    s = fold([approval, question], s);
    expect(s.approvals).toHaveLength(1);
    expect(s.questions).toHaveLength(1);
    s = fold([
      { type: "approval_resolved", approvalId: "apr_1", decision: "allow" },
      { type: "question_resolved", approvalId: "apr_2", decision: "deny" },
    ], s);
    expect(s.approvals).toHaveLength(0);
    expect(s.questions).toHaveLength(0);
  });

  it("folds a batch exactly like the same events one by one", () => {
    const events: RunEvent[] = [
      { type: "run_start", ...run },
      { type: "text", content: "a" },
      approval,
      { type: "text", content: "b" },
      { type: "approval_resolved", approvalId: "apr_1", decision: "deny" },
      { type: "knowledge", sources: [] },
      { type: "knowledge", sources: ["Doku"] },
    ];
    const batched = liveReducer(EMPTY_LIVE, { type: "events", events });
    expect(batched).toEqual(fold(events));
    // No sources → no row (matches the persisted transcript).
    expect(batched.items.map((m) => m.role)).toEqual(["assistant", "knowledge"]);
    expect(batched.approvals).toHaveLength(0);
  });

  it("reset clears items, approvals and questions", () => {
    const s = fold([{ type: "text", content: "x" }, approval, question]);
    expect(liveReducer(s, { type: "reset" })).toBe(EMPTY_LIVE);
  });

  it("streams orchestrator subtasks and synthesis", () => {
    const s = fold([
      { type: "plan", subtasks: [] },
      { type: "subtask_start", subtaskId: "a", title: "A", workerLabel: "Claude" },
      { type: "subtask_start", subtaskId: "b", title: "B", workerLabel: "Gemini" },
      { type: "subtask_text", subtaskId: "a", content: "1" },
      { type: "subtask_text", subtaskId: "b", content: "2" },
      { type: "subtask_text", subtaskId: "a", content: "3" },
      { type: "synthesis", content: "S" },
      { type: "synthesis", content: "um" },
    ]);
    expect(s.items.map((m) => m.content)).toEqual(["", "13", "2", "Sum"]);
  });

  it("renders loop progress as system dividers", () => {
    const s = fold([
      { type: "run_start", ...run, kind: "loop" },
      { type: "loop_iteration", iteration: 1, maxIterations: 10 },
      { type: "loop_end", reason: "promise", iterations: 1 },
    ]);
    expect(s.items.map((m) => [m.role, m.content])).toEqual([
      ["system", "🔁 Iteration 1/10"],
      ["system", "Ziel erreicht nach 1 Iteration"],
    ]);
    expect(runningLabel(s, false)).toBe("Loop läuft…");
    expect(runningLabel(fold([{ type: "loop_iteration", iteration: 2, maxIterations: 5 }], s), false))
      .toBe("Loop läuft · Iteration 2/5");
    expect(runningLabel(s, true)).toBe("Wird gestoppt…");
  });
});

describe("liveReducer — orchestra, reviews and fix rounds", () => {
  const orchRun = { type: "run_start" as const, runId: "run_o", kind: "orchestrate" as const, origin: "pwa" as const, startedAt: 100 };

  it("renders review rounds and fix rounds as their own rows under the subtask", () => {
    const s = fold([
      orchRun,
      { type: "plan", subtasks: [{ id: "a", title: "A", description: "", workerId: "claude", dependsOn: [], editsFiles: true, roleId: "coder" }], roles: [{ id: "coder", name: "Coder", editsFiles: true }] },
      { type: "subtask_start", subtaskId: "a", title: "A", workerId: "claude", workerLabel: "Claude Code", roleId: "coder", roleName: "Coder" },
      { type: "subtask_text", subtaskId: "a", content: "work" },
      { type: "review_start", subtaskId: "a", round: 1, maxRounds: 2, reviewerRoleId: "rev", reviewerRoleName: "Reviewer", reviewerLabel: "Gemini CLI" },
      { type: "review_text", subtaskId: "a", round: 1, content: "fix " },
      { type: "review_text", subtaskId: "a", round: 1, content: "this" },
      { type: "review_end", subtaskId: "a", round: 1, verdict: "changes" },
      { type: "subtask_text", subtaskId: "a", content: "\n\nfixed", fixRound: 1 },
      { type: "subtask_text", subtaskId: "a", content: " more", fixRound: 1 },
      { type: "review_start", subtaskId: "a", round: 2, maxRounds: 2, reviewerRoleName: "Reviewer" },
      { type: "review_end", subtaskId: "a", round: 2, verdict: "pass" },
      { type: "subtask_end", subtaskId: "a", workerLabel: "Claude Code" },
    ]);
    const rows = s.items.map((m) => ({ role: m.role, content: m.content, meta: metaOf(m) }));
    expect(rows[1]).toMatchObject({ content: "work", meta: { subtaskId: "a", roleName: "Coder", worker: "Claude Code" } });
    expect(rows[2]).toMatchObject({ content: "fix this", meta: { review: true, round: 1, maxRounds: 2, verdict: "changes", roleName: "Reviewer" } });
    expect(rows[3]).toMatchObject({ content: "fixed more", meta: { fixRound: 1, roleName: "Coder" } });
    expect(rows[4]).toMatchObject({ content: "", meta: { review: true, round: 2, verdict: "pass" } });
    // The orchestra live state follows the same events.
    expect(s.orch.active).toBe(true);
    expect(s.orch.roles).toEqual([{ id: "coder", name: "Coder", editsFiles: true }]);
    expect(s.orch.subtasks[0]).toMatchObject({ id: "a", status: "done", review: { round: 2, verdict: "pass" } });
  });

  it("nests subtask errors and ends the orchestra view with the run", () => {
    let s = fold([
      orchRun,
      { type: "subtask_start", subtaskId: "a", title: "A", workerLabel: "pi" },
      { type: "error", subtaskId: "a", content: "kaputt" },
      { type: "run_end", runId: "run_o", status: "error", error: "x", at: 500 },
    ]);
    expect(metaOf(s.items[1])).toEqual({ subtaskId: "a" });
    expect(s.orch.phase).toBe("error");
    expect(s.ended).toEqual({ status: "error", at: 500, error: "x", costUsd: 0 });
    // Settling keeps how the run ended and the orchestra view, nothing else.
    s = liveReducer(s, { type: "settle" });
    expect(s.items).toEqual([]);
    expect(s.ended?.status).toBe("error");
    expect(s.orch.phase).toBe("error");
  });

  it("seeds the orchestra view when attaching to a running orchestration", () => {
    const s = liveReducer(EMPTY_LIVE, { type: "seed", run: { runId: "r", kind: "orchestrate", origin: "pwa", startedAt: 5 }, pending: [] });
    expect(s.orch).toMatchObject({ active: true, phase: "planning", startedAt: 5 });
    const t = liveReducer(EMPTY_LIVE, { type: "seed", run, pending: [] });
    expect(t.orch.active).toBe(false);
  });

  it("sums reported costs into the run end", () => {
    const s = fold([
      { type: "run_start", ...run },
      { type: "result", costUsd: 0.25 },
      { type: "result", costUsd: 0 },
      { type: "result", costUsd: 0.13 },
      { type: "run_end", runId: "run_1", status: "idle" },
    ]);
    expect(s.ended?.costUsd).toBeCloseTo(0.38);
  });

  it("writes loop end notes from loopEndText, including blocked", () => {
    const s = fold([
      { type: "run_start", ...run, kind: "loop" },
      { type: "loop_iteration", iteration: 3, maxIterations: 10, freshContext: true, at: 7 },
      { type: "loop_end", reason: "blocked", iterations: 3 },
    ]);
    expect(s.items[0]).toMatchObject({ role: "system", content: "🔁 Iteration 3/10", at: 7 });
    expect(metaOf(s.items[0])).toEqual({ iteration: 3, maxIterations: 10, freshContext: true });
    expect(s.items[1].content).toBe("Blockiert in Iteration 3 – braucht deine Eingabe");
    expect(metaOf(s.items[1])).toEqual({ loopEnd: "blocked", iterations: 3 });
    expect(s.loop).toBeNull();
  });
});

describe("liveReducer — gate cards and receipts", () => {
  it("remembers where a card arrived and keeps a receipt when it is resolved", () => {
    let s = fold([
      { type: "text", content: "a" },
      { ...approval, at: 50 },
    ]);
    expect(s.approvals[0]).toMatchObject({ approvalId: "apr_1", pos: 1, receivedAt: 50 });
    s = fold([{ type: "approval_resolved", approvalId: "apr_1", decision: "allow", at: 60 }], s);
    expect(s.approvals).toHaveLength(0);
    expect(s.receipts).toEqual([
      expect.objectContaining({ approvalId: "apr_1", decision: "allow", by: "other", at: 60 }),
    ]);
  });

  it("marks a deny at the deadline as expired", () => {
    const s = fold([
      { ...approval, expiresAt: 10_000 },
      { type: "approval_resolved", approvalId: "apr_1", decision: "deny", at: 10_020 },
    ]);
    expect(s.receipts[0].by).toBe("timeout");
  });

  it("turns a local decision into a receipt and can restore the card", () => {
    let s = fold([approval]);
    s = liveReducer(s, { type: "decided", approvalId: "apr_1", decision: "deny", reason: "Nein", at: 9 });
    expect(s.approvals).toHaveLength(0);
    expect(s.receipts[0]).toMatchObject({ by: "self", decision: "deny", reason: "Nein" });
    // The server's echo does not overwrite the local receipt.
    const echoed = fold([{ type: "approval_resolved", approvalId: "apr_1", decision: "deny" }], s);
    expect(echoed.receipts).toHaveLength(1);
    expect(echoed.receipts[0].by).toBe("self");
    // Sending failed: the card comes back.
    s = liveReducer(s, { type: "restore", card: approval });
    expect(s.approvals.map((a) => a.approvalId)).toEqual(["apr_1"]);
    expect(s.receipts).toHaveLength(0);
  });

  it("does not resurrect decided cards from a snapshot and keeps arrival order", () => {
    let s = fold([approval, question]);
    s = liveReducer(s, { type: "decided", approvalId: "apr_1", decision: "allow" });
    s = liveReducer(s, { type: "pending", pending: [approval, question] });
    expect(s.approvals).toHaveLength(0);
    expect(pendingCards(s).map((c) => c.approvalId)).toEqual(["apr_2"]);
  });

  it("gives seeded cards their position when the replay reaches them", () => {
    let s = liveReducer(EMPTY_LIVE, { type: "seed", run, pending: [approval] });
    expect(s.approvals[0].pos).toBeUndefined();
    s = fold([{ type: "text", content: "x" }, approval], s);
    expect(s.approvals).toHaveLength(1);
    expect(s.approvals[0].pos).toBe(1);
  });
});

describe("liveReducer — finished without run_end", () => {
  it("records how a followed run ended, unless run_end already did", () => {
    const s = liveReducer(fold([{ type: "text", content: "x" }]), { type: "finished", status: "error" });
    expect(s.items).toEqual([]);
    expect(s.ended).toEqual({ status: "error", costUsd: 0 });
    const t = liveReducer(fold([{ type: "run_end", runId: "r", status: "stopped", at: 3 }]), { type: "finished", status: "idle" });
    expect(t.ended).toMatchObject({ status: "stopped", at: 3 });
  });
});

describe("stateAnnouncement", () => {
  it("announces a run start, the end and stops — once", () => {
    expect(stateAnnouncement("idle", "running")).toBe("Läuft");
    expect(stateAnnouncement("done", "telegram")).toBe("Läuft · via Telegram");
    expect(stateAnnouncement("running", "done")).toBe("Antwort fertig");
    expect(stateAnnouncement("running", "stopping")).toBe("Wird gestoppt …");
    expect(stateAnnouncement("stopping", "stopped")).toBe("Gestoppt");
    expect(stateAnnouncement("background", "unknown")).toBe("Status unbekannt");
    expect(stateAnnouncement("running", "running")).toBeNull();
  });

  it("stays quiet where another announcement covers it or nothing is new", () => {
    // Gates: assertive announcement by the thread.
    expect(stateAnnouncement("running", "waiting_approval")).toBeNull();
    expect(stateAnnouncement("running", "waiting_answer")).toBeNull();
    // Back to work after a decision or a loop pause.
    expect(stateAnnouncement("waiting_approval", "running")).toBeNull();
    expect(stateAnnouncement("loop_paused", "running")).toBeNull();
    // Errors: the run-end alert.
    expect(stateAnnouncement("running", "error")).toBeNull();
    // A finished state that was not reached from a run.
    expect(stateAnnouncement("idle", "done")).toBeNull();
    expect(stateAnnouncement("done", "idle")).toBeNull();
  });
});
