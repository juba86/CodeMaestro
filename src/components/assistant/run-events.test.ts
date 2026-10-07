import { describe, expect, it } from "vitest";
import { EMPTY_LIVE, liveReducer, runningLabel, type LiveState } from "./run-events";
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
      ["system", "✅ Abschluss-Signal erkannt · 1 Iteration"],
    ]);
    expect(runningLabel(s, false)).toBe("Loop läuft…");
    expect(runningLabel(fold([{ type: "loop_iteration", iteration: 2, maxIterations: 5 }], s), false))
      .toBe("Loop läuft · Iteration 2/5");
    expect(runningLabel(s, true)).toBe("Wird gestoppt…");
  });
});
