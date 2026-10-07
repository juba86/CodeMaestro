import { describe, expect, it } from "vitest";
import type { ApprovalEvent } from "@/lib/assistant/approvals";
import { buildActivity, type ActivityRunInfo, type ActivitySession } from "./activity";

const NOW = 1_800_000_000_000;

const sessions: ActivitySession[] = [
  { id: "s1", title: "Auth-Refactor", cwd: "/apps/shop", provider: "claude", model: "opus" },
  { id: "s2", title: "", cwd: "/apps/blog", provider: "pi", model: "qwen3" },
  { id: "s3", title: "Ruhig", cwd: "/apps/idle", provider: "gemini", model: "" },
];

function fakes(runs: Record<string, ActivityRunInfo>, pending: Record<string, ApprovalEvent[]>) {
  return {
    getRun: (id: string) => runs[id] ?? null,
    listPending: (id: string) => pending[id] ?? [],
  };
}

describe("buildActivity", () => {
  it("returns an empty snapshot when nothing runs", () => {
    const f = fakes({}, {});
    expect(buildActivity(sessions, f.getRun, f.listPending, NOW)).toEqual({ serverTime: NOW, runs: [], pending: [] });
  });

  it("lists active runs newest first with session facts", () => {
    const f = fakes(
      {
        s1: { kind: "turn", origin: "pwa", startedAt: NOW - 60_000 },
        s2: { kind: "loop", origin: "telegram", startedAt: NOW - 5_000 },
      },
      {}
    );
    const { runs } = buildActivity(sessions, f.getRun, f.listPending, NOW);
    expect(runs).toEqual([
      { sessionId: "s2", title: "/apps/blog", cwd: "/apps/blog", provider: "pi", model: "qwen3", kind: "loop", origin: "telegram", startedAt: NOW - 5_000 },
      { sessionId: "s1", title: "Auth-Refactor", cwd: "/apps/shop", provider: "claude", model: "opus", kind: "turn", origin: "pwa", startedAt: NOW - 60_000 },
    ]);
  });

  it("skips finished runs", () => {
    const f = fakes({ s1: { kind: "turn", origin: "pwa", startedAt: NOW, done: true } }, {});
    expect(buildActivity(sessions, f.getRun, f.listPending, NOW).runs).toEqual([]);
  });

  it("lists pending items soonest expiry first, unknown expiry last", () => {
    const f = fakes(
      { s1: { kind: "turn", origin: "pwa", startedAt: NOW } },
      {
        s1: [
          { type: "approval_request", approvalId: "a_late", tool: "Bash", command: "npm test", expiresAt: NOW + 300_000 },
          { type: "question_request", approvalId: "q_none", tool: "AskUserQuestion", kind: "ask" },
        ],
        s2: [{ type: "approval_request", approvalId: "a_soon", tool: "Write", filePath: "src/a.ts", isWrite: true, overwrites: false, expiresAt: NOW + 30_000 }],
        s3: [{ type: "question_request", approvalId: "p_mid", tool: "ExitPlanMode", kind: "plan", expiresAt: NOW + 120_000 }],
      }
    );
    const { pending } = buildActivity(sessions, f.getRun, f.listPending, NOW);
    expect(pending.map((p) => p.approvalId)).toEqual(["a_soon", "p_mid", "a_late", "q_none"]);
    expect(pending[0]).toEqual({
      sessionId: "s2",
      sessionTitle: "/apps/blog",
      approvalId: "a_soon",
      type: "approval_request",
      tool: "Write",
      filePath: "src/a.ts",
      isWrite: true,
      overwrites: false,
      expiresAt: NOW + 30_000,
    });
    expect(pending[2]).toEqual({
      sessionId: "s1",
      sessionTitle: "Auth-Refactor",
      approvalId: "a_late",
      type: "approval_request",
      tool: "Bash",
      command: "npm test",
      expiresAt: NOW + 300_000,
    });
  });

  it("never includes diffs, questions or plan text", () => {
    const f = fakes(
      {},
      {
        s1: [
          {
            type: "approval_request",
            approvalId: "a1",
            tool: "Edit",
            filePath: "src/x.ts",
            diff: [{ op: "add", text: "secret change" }],
            expiresAt: NOW + 1,
          },
          {
            type: "question_request",
            approvalId: "q1",
            tool: "ExitPlanMode",
            kind: "plan",
            plan: "Step 1 … Step 9",
            questions: [{ question: "Welche DB?", options: [{ label: "SQLite" }] }],
            expiresAt: NOW + 2,
          },
        ],
      }
    );
    const { pending } = buildActivity(sessions, f.getRun, f.listPending, NOW);
    const json = JSON.stringify(pending);
    expect(json).not.toContain("diff");
    expect(json).not.toContain("secret change");
    expect(json).not.toContain("plan\":\"");
    expect(json).not.toContain("Welche DB?");
    for (const p of pending) {
      expect(Object.keys(p).every((k) =>
        ["sessionId", "sessionTitle", "approvalId", "type", "kind", "tool", "filePath", "command", "isWrite", "overwrites", "expiresAt"].includes(k)
      )).toBe(true);
    }
  });

  it("drops resolved events and decided requests", () => {
    const f = fakes(
      {},
      {
        s1: [
          { type: "approval_resolved", approvalId: "a1", decision: "allow" },
          { type: "question_resolved", approvalId: "q1" },
          { type: "approval_request", approvalId: "a2", decision: "deny" },
        ],
      }
    );
    expect(buildActivity(sessions, f.getRun, f.listPending, NOW).pending).toEqual([]);
  });

  it("clips very long commands", () => {
    const long = "x".repeat(2_000);
    const f = fakes({}, { s1: [{ type: "approval_request", approvalId: "a1", tool: "Bash", command: long }] });
    const [p] = buildActivity(sessions, f.getRun, f.listPending, NOW).pending;
    expect(p.command!.length).toBe(501);
    expect(p.command!.endsWith("…")).toBe(true);
  });
});
