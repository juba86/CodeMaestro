import { describe, expect, it } from "vitest";
import { topHeadingDepth } from "./markdown-outline";
import { row } from "./meta";
import { EMPTY_LIVE, liveReducer } from "./run-events";
import { buildThread, iterationOf, latestLoop, threadRows, type ThreadBlock } from "./thread-model";
import type { Msg, RunEvent } from "./types";

const kinds = (blocks: ThreadBlock[]) => blocks.map((b) => b.kind);
const persisted = (msgs: Msg[]) => msgs.map((m, i) => ({ ...m, id: m.id ?? `m${i}` }));

describe("buildThread", () => {
  it("folds tool rows into one group and marks segment starts", () => {
    const msgs = persisted([
      { role: "user", content: "Fix it" },
      { role: "assistant", content: "Ich schaue nach." },
      row({ role: "tool_use", content: "Read" }, { name: "Read", input: { file_path: "/p/a.ts" }, toolUseId: "t1" }),
      row({ role: "tool_result", content: "x" }, { toolUseId: "t1" }),
      row({ role: "tool_use", content: "Bash" }, { name: "Bash", input: { command: "npm test" }, toolUseId: "t2" }),
      row({ role: "tool_result", content: "boom" }, { toolUseId: "t2", isError: true }),
      { role: "assistant", content: "Fertig." },
    ]);
    const blocks = buildThread(threadRows(msgs, [], false), { cwd: "/p" });
    expect(kinds(blocks)).toEqual(["user", "assistant", "tools", "assistant"]);
    const tools = blocks[2];
    expect(tools.kind === "tools" && tools.group.calls.map((c) => [c.label, c.target, c.status])).toEqual([
      ["Lesen", "a.ts", "ok"],
      ["Befehl", "npm test", "error"],
    ]);
    expect(blocks.map((b) => ("segmentStart" in b ? b.segmentStart : null))).toEqual([null, true, false, false]);
  });

  it("places gates after the live row they followed and keeps call/result paired across them", () => {
    let live = EMPTY_LIVE;
    const events: RunEvent[] = [
      { type: "run_start", runId: "r", kind: "turn", origin: "pwa", startedAt: 1 },
      { type: "tool_use", name: "Bash", input: { command: "rm -rf x" }, toolUseId: "t1" },
      { type: "approval_request", approvalId: "g1", tool: "Bash", command: "rm -rf x" },
      { type: "approval_resolved", approvalId: "g1", decision: "allow" },
      { type: "tool_result", toolUseId: "t1", content: "ok" },
      { type: "text", content: "Erledigt" },
    ];
    for (const event of events) live = liveReducer(live, { type: "event", event });
    const gates = live.receipts.map((r) => ({ approvalId: r.approvalId, pos: r.card.pos }));
    const blocks = buildThread(threadRows([], live.items, true), { gates });
    expect(kinds(blocks)).toEqual(["tools", "gate", "assistant"]);
    const tools = blocks[0];
    expect(tools.kind === "tools" && tools.group.calls[0].status).toBe("ok");
  });

  it("puts seeded cards without a position at the end", () => {
    const blocks = buildThread(threadRows(persisted([{ role: "user", content: "x" }]), [], true), { gates: [{ approvalId: "g" }] });
    expect(kinds(blocks)).toEqual(["user", "gate"]);
  });

  it("builds one section per subtask with work, review and fix parts (persisted rows)", () => {
    const msgs = persisted([
      { role: "user", content: "Baue X" },
      { role: "plan", content: "Baue X", meta: JSON.stringify({ subtasks: [{ id: "1", title: "Code" }, { id: "2", title: "Doku" }], workers: [{ id: "claude", label: "Claude Code" }], roles: [{ id: "coder", name: "Coder" }] }) },
      { role: "assistant", content: "Code fertig", meta: JSON.stringify({ subtaskId: "1", title: "Code", worker: "Claude Code", roleId: "coder", roleName: "Coder" }) },
      { role: "assistant", content: "Bitte Tests", meta: JSON.stringify({ subtaskId: "1", review: true, round: 1, verdict: "changes", roleName: "Reviewer", worker: "Gemini CLI" }) },
      { role: "assistant", content: "Tests ergänzt", meta: JSON.stringify({ subtaskId: "1", fixRound: 1, roleName: "Coder" }) },
      { role: "assistant", content: "passt", meta: JSON.stringify({ subtaskId: "1", review: true, round: 2, verdict: "pass", roleName: "Reviewer" }) },
      { role: "error", content: "Doku fehlgeschlagen", meta: JSON.stringify({ subtaskId: "2" }) },
      { role: "synthesis", content: "Alles erledigt" },
    ]);
    const blocks = buildThread(threadRows(msgs, [], false));
    expect(kinds(blocks)).toEqual(["user", "plan", "subtask", "subtask", "synthesis"]);
    const plan = blocks[1];
    expect(plan.kind === "plan" && plan.workers).toEqual([{ id: "claude", label: "Claude Code" }]);
    const s1 = blocks[2].kind === "subtask" ? blocks[2].section : null;
    expect(s1).toMatchObject({ subtaskId: "1", title: "Code", roleName: "Coder", workerLabel: "Claude Code", hasError: false, index: 1 });
    expect(s1?.parts.map((p) => [p.kind, "round" in p ? p.round : null, p.kind === "review" ? p.verdict : null])).toEqual([
      ["work", null, null],
      ["review", 1, "changes"],
      ["fix", 1, null],
      ["review", 2, "pass"],
    ]);
    const s2 = blocks[3].kind === "subtask" ? blocks[3].section : null;
    expect(s2).toMatchObject({ subtaskId: "2", title: "Teilaufgabe 2", hasError: true, index: 2 });
  });

  it("scopes subtask ids per orchestration", () => {
    const sub = (id: string, content: string) => ({ role: "assistant", content, meta: JSON.stringify({ subtaskId: id, title: content }) });
    const msgs = persisted([
      { role: "plan", content: "", meta: JSON.stringify({ subtasks: [{ id: "1" }] }) },
      sub("1", "erster Lauf"),
      { role: "user", content: "nochmal" },
      { role: "plan", content: "", meta: JSON.stringify({ subtasks: [{ id: "1" }] }) },
      sub("1", "zweiter Lauf"),
    ]);
    const sections = buildThread(threadRows(msgs, [], false)).filter((b) => b.kind === "subtask");
    expect(sections).toHaveLength(2);
  });

  it("renders loop prompts, dividers, pauses and the end note", () => {
    const msgs = persisted([
      { role: "user", content: "🔁 Loop: Mach weiter", meta: JSON.stringify({ loop: { maxIterations: 3, completionPromise: "DONE" } }) },
      { role: "system", content: "🔁 Iteration 1/3", createdAt: "2026-10-07T10:00:00.000Z" },
      { role: "assistant", content: "eins" },
      { role: "system", content: "⏸ Pause 1:00 bis zur nächsten Iteration", meta: JSON.stringify({ resumeAt: 5 }) },
      { role: "system", content: "🔁 Iteration 2/3", createdAt: "2026-10-07T10:02:00.000Z" },
      { role: "error", content: "kaputt" },
      { role: "system", content: "Abbruch nach Fehler · 2 Iterationen", meta: JSON.stringify({ loopEnd: "error", iterations: 2 }), createdAt: "2026-10-07T10:03:30.000Z" },
      { role: "system", content: "⏹ Ausführung gestoppt." },
    ]);
    const rows = threadRows(msgs, [], false);
    const blocks = buildThread(rows);
    expect(kinds(blocks)).toEqual(["user", "iteration", "assistant", "loop_wait", "iteration", "error", "loop_end", "system"]);
    expect(blocks[0]).toMatchObject({ text: "Mach weiter", loop: true });
    expect(blocks[1]).toMatchObject({ iteration: 1, max: 3, at: Date.parse("2026-10-07T10:00:00.000Z") });
    expect(blocks[6]).toMatchObject({ reason: "error", iterations: 2 });
    expect(blocks[7]).toMatchObject({ text: "Ausführung gestoppt." });
    expect(iterationOf(blocks)).toEqual([0, 1001, 1001, 1001, 1002, 1002, 0, 0]);

    const loop = latestLoop(rows);
    expect(loop?.settings).toMatchObject({ maxIterations: 3, completionPromise: "DONE" });
    expect(loop?.end).toEqual({ reason: "error", iterations: 2 });
    expect(loop?.iterations).toEqual([
      { iteration: 1, startedAt: Date.parse("2026-10-07T10:00:00.000Z"), endedAt: Date.parse("2026-10-07T10:02:00.000Z"), state: "done" },
      { iteration: 2, startedAt: Date.parse("2026-10-07T10:02:00.000Z"), endedAt: Date.parse("2026-10-07T10:03:30.000Z"), state: "failed" },
    ]);
  });

  it("follows a running loop from live rows", () => {
    let live = EMPTY_LIVE;
    for (const event of [
      { type: "run_start", runId: "r", kind: "loop", origin: "pwa", startedAt: 1 },
      { type: "loop_iteration", iteration: 1, maxIterations: 10, at: 100 },
      { type: "text", content: "a" },
      { type: "loop_iteration", iteration: 2, maxIterations: 10, at: 300 },
    ] as RunEvent[]) live = liveReducer(live, { type: "event", event });
    const loop = latestLoop(threadRows([], live.items, true));
    expect(loop?.max).toBe(10);
    expect(loop?.iterations.map((i) => [i.iteration, i.state, i.endedAt])).toEqual([
      [1, "done", 300],
      [2, "current", undefined],
    ]);
    expect(latestLoop(threadRows([{ role: "user", content: "hi" }], [], false))).toBeNull();
  });
});

describe("topHeadingDepth", () => {
  it("finds the shallowest heading outside code fences", () => {
    expect(topHeadingDepth("Text ohne Überschrift")).toBe(1);
    expect(topHeadingDepth("## A\n### B")).toBe(2);
    expect(topHeadingDepth("```\n# not a heading\n```\n### C")).toBe(3);
    expect(topHeadingDepth("~~~sh\n# x\n~~~\n#nope\n#### D")).toBe(4);
  });
});
