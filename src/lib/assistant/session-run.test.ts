import { beforeEach, describe, expect, it, vi } from "vitest";

// --- In-memory Prisma stand-in -------------------------------------------------
type Row = { sessionId: string; role: string; content: string; meta: string; createdAt: Date };
const db = vi.hoisted(() => ({
  sessions: new Map<string, Record<string, unknown>>(),
  messages: [] as Row[],
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    assistantSession: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => db.sessions.get(where.id) ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const s = db.sessions.get(where.id);
        if (!s) throw new Error("not found");
        for (const [k, v] of Object.entries(data)) {
          if (v && typeof v === "object" && "increment" in (v as object)) {
            s[k] = Number(s[k] ?? 0) + Number((v as { increment: number }).increment);
          } else {
            s[k] = v;
          }
        }
        return s;
      }),
    },
    assistantMessage: {
      create: vi.fn(async ({ data }: { data: Row }) => {
        db.messages.push(data);
        return data;
      }),
    },
  },
}));

vi.mock("@/lib/knowledge/retrieve", () => ({
  augmentPromptWithKnowledge: vi.fn(async (prompt: string) => ({ injected: false, prompt, sources: [] })),
}));
vi.mock("@/lib/push", () => ({ notifySession: vi.fn(async () => {}) }));

const runTurnMock = vi.hoisted(() => vi.fn());
vi.mock("./runner", async (orig) => ({
  ...(await orig<typeof import("./runner")>()),
  runTurn: runTurnMock,
}));

import { executeTurn, launchRun, persistUserMessage, stopRunNow } from "./session-run";
import { getActiveRun, subscribe, type BufferedEvent } from "./run-hub";

function seedSession(id: string) {
  db.sessions.set(id, {
    id, externalId: null, provider: "claude", model: "", title: "", cwd: "/tmp",
    permissionMode: "default", allowedTools: "Read", approvalMode: "off", sandbox: false,
    status: "idle", totalCostUsd: 0,
  });
}

function collect(sessionId: string): BufferedEvent[] {
  const sub = subscribe(sessionId, 0, () => {});
  sub?.unsubscribe();
  return sub?.replay ?? [];
}

let n = 0;
beforeEach(() => {
  db.messages.length = 0;
  runTurnMock.mockReset();
});

describe("launchRun + executeTurn", () => {
  it("runs detached, persists the transcript in stream order and finalizes the session", async () => {
    const id = `sr-${++n}`;
    seedSession(id);
    runTurnMock.mockImplementation(async (_row, _prompt, _key, emit) => {
      emit({ type: "init", sessionId: "cli-uuid-1" });
      emit({ type: "text", content: "Let me look. " });
      emit({ type: "tool_use", name: "Read", input: { file_path: "a.ts" }, toolUseId: "t1" });
      emit({ type: "tool_result", toolUseId: "t1", content: "file body" });
      emit({ type: "text", content: "Done." });
      emit({ type: "result", content: "Done.", costUsd: 0.01, isError: false });
      emit({ type: "done" });
      return { externalId: "cli-uuid-1", costUsd: 0.01, isError: false };
    });

    await persistUserMessage(id, "fix it");
    const run = await launchRun({ sessionId: id, kind: "turn", origin: "pwa", title: "fix it", work: (ctx) => executeTurn(ctx, "fix it") });
    expect(db.sessions.get(id)?.status).toBe("running");
    await expect(run.finished).resolves.toBe("idle");

    expect(db.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool_use", "tool_result", "assistant"]);
    const times = db.messages.map((m) => m.createdAt.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(new Set(times).size).toBe(times.length);
    expect(times[1]).toBeGreaterThan(run.info.startedAt);
    expect(times[0]).toBeLessThan(run.info.startedAt);

    const s = db.sessions.get(id)!;
    expect(s.status).toBe("idle");
    expect(s.externalId).toBe("cli-uuid-1");
    expect(s.totalCostUsd).toBeCloseTo(0.01);

    const types = collect(id).map((e) => e.data.type);
    expect(types[0]).toBe("run_start");
    expect(types.at(-1)).toBe("run_end");
    expect(types).not.toContain("done");
  });

  it("marks the run stopped when aborted and records it", async () => {
    const id = `sr-${++n}`;
    seedSession(id);
    runTurnMock.mockImplementation(async (_row, _p, _k, emit, opts: { signal: AbortSignal }) => {
      await new Promise<void>((resolve) => opts.signal.addEventListener("abort", () => resolve()));
      emit({ type: "error", content: "Gestoppt." });
      return { externalId: null, costUsd: 0, isError: true };
    });
    const run = await launchRun({ sessionId: id, kind: "turn", origin: "pwa", work: (ctx) => executeTurn(ctx, "x") });
    expect(getActiveRun(id)).not.toBeNull();
    expect(stopRunNow(id).stopped).toBe(true);
    await expect(run.finished).resolves.toBe("stopped");
    expect(db.sessions.get(id)?.status).toBe("idle");
    expect(db.messages.some((m) => m.role === "system" && m.content.includes("gestoppt"))).toBe(true);
    const end = collect(id).at(-1)!.data;
    expect(end).toMatchObject({ type: "run_end", status: "stopped" });
  });

  it("never leaves the session running when the work throws", async () => {
    const id = `sr-${++n}`;
    seedSession(id);
    const run = await launchRun({ sessionId: id, kind: "loop", origin: "pwa", work: async () => { throw new Error("boom"); } });
    await expect(run.finished).resolves.toBe("error");
    expect(db.sessions.get(id)?.status).toBe("error");
    expect(getActiveRun(id)).toBeNull();
    expect(db.messages.some((m) => m.role === "error" && m.content === "boom")).toBe(true);
  });

  it("does not overwrite the resume id for a fresh-context turn", async () => {
    const id = `sr-${++n}`;
    seedSession(id);
    db.sessions.get(id)!.externalId = "keep-me";
    runTurnMock.mockResolvedValue({ externalId: "throwaway", costUsd: 0, isError: false });
    const run = await launchRun({
      sessionId: id, kind: "loop", origin: "pwa",
      work: (ctx) => executeTurn(ctx, "x", { rowOverrides: { externalId: null } }),
    });
    await run.finished;
    expect(db.sessions.get(id)?.externalId).toBe("keep-me");
    expect(runTurnMock.mock.calls[0][0].externalId).toBeNull();
  });
});
