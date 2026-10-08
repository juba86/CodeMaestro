import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

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
vi.mock("@/lib/assistant/security", async (orig) => ({
  ...(await orig<typeof import("@/lib/assistant/security")>()),
  resolveWorkdir: async (p: string) => p,
}));

const runTurnMock = vi.hoisted(() => vi.fn());
vi.mock("./runner", async (orig) => ({
  ...(await orig<typeof import("./runner")>()),
  runTurn: runTurnMock,
}));

import { executeTurn, launchRun, stopRunNow } from "./session-run";
import { SessionBusyError, getActiveRun, subscribe, type BufferedEvent } from "./run-hub";
import { createApproval, listPending, waitForDecision } from "./approvals";
import { POST as postMessage } from "@/app/api/assistant/sessions/[id]/message/route";
import { POST as postLoop } from "@/app/api/assistant/sessions/[id]/loop/route";

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

    const run = await launchRun({
      sessionId: id, kind: "turn", origin: "pwa", title: "fix it",
      userMessage: { content: "fix it" },
      work: (ctx) => executeTurn(ctx, "fix it"),
    });
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

const userRows = (id: string) => db.messages.filter((m) => m.sessionId === id && m.role === "user");

describe("starting a run persists the user message only for the start that wins", () => {
  it("launchRun: of two concurrent starts exactly one claims the session and writes its row", async () => {
    const id = `sr-${++n}`;
    seedSession(id);
    runTurnMock.mockResolvedValue({ externalId: null, costUsd: 0, isError: false });
    const start = (prompt: string) =>
      launchRun({ sessionId: id, kind: "turn", origin: "pwa", userMessage: { content: prompt }, work: (ctx) => executeTurn(ctx, prompt) });

    const [a, b] = await Promise.allSettled([start("first"), start("second")]);
    expect(a.status).toBe("fulfilled");
    expect(b.status === "rejected" && b.reason).toBeInstanceOf(SessionBusyError);
    const run = (a as PromiseFulfilledResult<Awaited<ReturnType<typeof start>>>).value;
    await run.finished;

    const users = userRows(id);
    expect(users.map((m) => m.content)).toEqual(["first"]);
    // Still strictly before the run start: GET cuts the transcript there and the
    // client replays the run, so a later timestamp would hide the prompt.
    expect(users[0].createdAt.getTime()).toBeLessThan(run.info.startedAt);
  });

  it("writes nothing when the session is already busy", async () => {
    const id = `sr-${++n}`;
    seedSession(id);
    let finish!: () => void;
    const first = await launchRun({
      sessionId: id, kind: "loop", origin: "telegram", userMessage: { content: "running" },
      work: () => new Promise((r) => { finish = () => r({ isError: false }); }),
    });
    await expect(
      launchRun({ sessionId: id, kind: "turn", origin: "pwa", userMessage: { content: "late" }, work: async () => ({ isError: false }) })
    ).rejects.toBeInstanceOf(SessionBusyError);
    finish();
    await first.finished;
    expect(userRows(id).map((m) => m.content)).toEqual(["running"]);
  });

  const routes = {
    message: (id: string, prompt: string) => postMessage(
      new NextRequest(`http://127.0.0.1:3000/api/assistant/sessions/${id}/message`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt, useKnowledge: false }),
      }),
      { params: Promise.resolve({ id }) }
    ),
    loop: (id: string, prompt: string) => postLoop(
      new NextRequest(`http://127.0.0.1:3000/api/assistant/sessions/${id}/loop`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt, maxIterations: 1 }),
      }),
      { params: Promise.resolve({ id }) }
    ),
  };

  for (const [name, post] of Object.entries(routes)) {
    it(`POST ${name}: two concurrent requests give one 202, one 409 and exactly one user row`, async () => {
      const id = `sr-${++n}`;
      seedSession(id);
      runTurnMock.mockResolvedValue({ externalId: null, costUsd: 0, isError: false });
      // Both requests pass the early isSessionBusy check before either claims.
      const [a, b] = await Promise.all([post(id, "eins"), post(id, "zwei")]);
      expect([a.status, b.status].sort()).toEqual([202, 409]);
      const busy = a.status === 409 ? a : b;
      expect(((await busy.json()) as { code: string }).code).toBe("SESSION_BUSY");
      const ok = (await (a.status === 202 ? a : b).json()) as { runId: string; startedAt: number };

      const users = userRows(id);
      expect(users).toHaveLength(1);
      expect(users[0].content).toContain(a.status === 202 ? "eins" : "zwei");
      expect(users[0].createdAt.getTime()).toBeLessThan(ok.startedAt);
      await vi.waitFor(() => expect(getActiveRun(id)).toBeNull());
    });
  }
});

describe("open approvals when a run ends", () => {
  it("denies approvals and questions a run leaves open without Stop (CLI crash)", async () => {
    const id = `sr-${++n}`;
    seedSession(id);
    const ids: string[] = [];
    const run = await launchRun({
      sessionId: id, kind: "turn", origin: "pwa",
      work: async () => {
        for (const [tool, input] of [
          ["Bash", { command: "rm -rf build" }],
          ["AskUserQuestion", { questions: [{ question: "Welche DB?", options: ["sqlite", "pg"] }] }],
        ] as const) {
          const r = await createApproval(id, tool, input);
          if ("approvalId" in r) ids.push(r.approvalId);
        }
        expect(listPending(id)).toHaveLength(2);
        return { isError: true }; // the CLI died while its hooks were still waiting
      },
    });
    await expect(run.finished).resolves.toBe("error");

    expect(ids).toHaveLength(2);
    expect(listPending(id)).toEqual([]);
    for (const a of ids) {
      await expect(waitForDecision(a, 10)).resolves.toEqual({ decision: "deny", reason: "Lauf beendet." });
    }
    // The resolutions are part of the finished run, so replaying clients drop the cards.
    const types = collect(id).map((e) => e.data.type);
    expect(types.slice(-3)).toEqual(["approval_resolved", "question_resolved", "run_end"]);

    // The next run's snapshot starts clean.
    const next = await launchRun({
      sessionId: id, kind: "turn", origin: "pwa",
      work: async () => ({ isError: listPending(id).length > 0 }),
    });
    await expect(next.finished).resolves.toBe("idle");
  });
});
