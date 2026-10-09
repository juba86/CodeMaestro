import { afterEach, describe, expect, it, vi } from "vitest";

// The route reads runs and gates from memory and asks the database only for
// the display fields of those sessions; keep it offline and DB-free.
const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ prisma: { assistantSession: { findMany } } }));
vi.mock("@/lib/push", () => ({ notifySession: vi.fn(async () => {}) }));

import { GET } from "./route";
import { beginRun, endRun } from "@/lib/assistant/run-hub";
import { createApproval, denyAllPending } from "@/lib/assistant/approvals";

let n = 0;
const sid = () => `activity-route-${++n}`;

afterEach(() => {
  findMany.mockReset();
});

describe("GET /api/assistant/activity", () => {
  it("answers an idle app without touching the database", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runs: unknown[]; pending: unknown[]; serverTime: number };
    expect(body.runs).toEqual([]);
    expect(body.pending).toEqual([]);
    expect(typeof body.serverTime).toBe("number");
    expect(findMany).not.toHaveBeenCalled();
  });

  it("looks up exactly the sessions that run or wait on a gate", async () => {
    const running = sid();
    const gated = sid();
    const run = beginRun(running, "turn", "pwa");
    const gateRun = beginRun(gated, "turn", "telegram");
    await createApproval(gated, "Bash", { command: "ls" });
    findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
      where.id.in.map((id) => ({ id, title: `T ${id}`, cwd: "/w", provider: "claude", model: "" }))
    );
    try {
      const body = (await (await GET()).json()) as {
        runs: { sessionId: string; origin: string }[];
        pending: { sessionId: string; command?: string }[];
      };
      expect(findMany).toHaveBeenCalledTimes(1);
      const ids = (findMany.mock.calls[0][0] as { where: { id: { in: string[] } } }).where.id.in;
      expect(new Set(ids)).toEqual(new Set([running, gated]));
      expect(body.runs.map((r) => r.sessionId).sort()).toEqual([running, gated].sort());
      expect(body.pending).toMatchObject([{ sessionId: gated, command: "ls" }]);
    } finally {
      denyAllPending(gated);
      endRun(running, run.info.runId, "idle");
      endRun(gated, gateRun.info.runId, "idle");
    }
  });
});
