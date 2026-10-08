import { beforeEach, describe, expect, it, vi } from "vitest";

type TurnResult = { isError: boolean; resultText: string; externalId?: string | null } | Error;

const state = vi.hoisted(() => ({
  turns: [] as Array<{ prompt: string; opts: Record<string, unknown> }>,
  results: [] as TurnResult[],
  provider: "claude" as string | null,
  published: [] as Array<Record<string, unknown>>,
  rows: [] as Array<{ role: string; content: string }>,
  // userMessage handed to launchRun (it persists the row once the session is claimed).
  persisted: [] as Array<{ content: string; meta?: string } | undefined>,
  ac: new AbortController(),
}));

vi.mock("./session-run", () => ({
  executeTurn: async (_ctx: unknown, prompt: string, opts: Record<string, unknown>) => {
    state.turns.push({ prompt, opts });
    const r = state.results.shift() ?? { isError: false, resultText: "working" };
    if (r instanceof Error) throw r;
    return { costUsd: 0, externalId: "ext-1", ...r };
  },
  launchRun: async (o: { sessionId: string; kind: string; title: string; userMessage?: { content: string; meta?: string }; work: (ctx: unknown) => Promise<unknown> }) => {
    state.persisted.push(o.userMessage);
    const ctx = {
      sessionId: o.sessionId, runId: "r1", signal: state.ac.signal,
      publish: (e: Record<string, unknown>) => state.published.push(e),
      writer: { add: (r: { role: string; content: string }) => state.rows.push(r), flushText: () => {} },
    };
    let outcome: unknown;
    let thrown: unknown;
    try { outcome = await o.work(ctx); } catch (e) { thrown = e; }
    return { info: { runId: "r1", kind: o.kind, title: o.title }, outcome, thrown };
  },
}));
vi.mock("@/lib/db/client", () => ({
  prisma: { assistantSession: { findUnique: async () => (state.provider ? { provider: state.provider } : null) } },
}));

import { BLOCKED_PROMISE, buildIterationPrompt, hasCompletionPromise, startLoopRun } from "./loop";

const base = { prompt: "Fix the failing tests in src/foo", maxIterations: 5, completionPromise: "DONE", freshContext: false };
type Started = { outcome: unknown; info: { title: string } };

beforeEach(() => {
  state.turns.length = 0;
  state.published.length = 0;
  state.rows.length = 0;
  state.persisted.length = 0;
  state.results = [];
  state.provider = "claude";
  state.ac = new AbortController();
});

describe("loop prompts", () => {
  it("carries the full task first, then a short reminder; fresh context uses a progress file", () => {
    const p1 = buildIterationPrompt(base, 1);
    const p2 = buildIterationPrompt(base, 2);
    const f2 = buildIterationPrompt({ ...base, freshContext: true }, 2);
    expect(p1).toContain("<task>\nFix the failing tests in src/foo\n</task>");
    expect(p1).toContain("iteration 1 of at most 5.");
    expect(p1).toContain("\n<promise>DONE</promise>\n");
    expect(p1).toContain(`<promise>${BLOCKED_PROMISE}</promise>`);
    expect(p2).not.toContain("<task>");
    expect(f2).toContain(".codemaestro/loop-progress.md");
    expect(p1).not.toContain("loop-progress.md");
  });

  it("matches the promise exactly", () => {
    expect(hasCompletionPromise("all good\n<promise>DONE</promise>", "DONE")).toBe(true);
    expect(hasCompletionPromise("x <promise> DONE </promise> y", "DONE")).toBe(true);
    expect(hasCompletionPromise("<promise>done</promise>", "DONE")).toBe(false);
    expect(hasCompletionPromise("DONE", "DONE")).toBe(false);
    expect(hasCompletionPromise("<promise></promise>", "")).toBe(false);
  });
});

describe("startLoopRun", () => {
  it("ends on the completion promise and never persists the API key", async () => {
    state.results = [{ isError: false, resultText: "step" }, { isError: false, resultText: "done\n<promise>DONE</promise>" }];
    const h = (await startLoopRun("s1", { ...base, freshContext: true, apiKey: "sk-secret", intervalSec: 0 }, "pwa")) as unknown as Started;
    expect(h.outcome).toEqual({ isError: false });
    expect(state.published.at(-1)).toEqual({ type: "loop_end", reason: "promise", iterations: 2 });
    expect(state.persisted[0]?.content).toBe("🔁 Loop: Fix the failing tests in src/foo");
    expect(JSON.parse(state.persisted[0]?.meta ?? "{}").loop).toMatchObject({ maxIterations: 5, freshContext: true });
    expect(JSON.stringify(state.persisted[0])).not.toContain("sk-secret");
    expect(state.turns[0].opts.rowOverrides).toEqual({ externalId: null });
    expect(h.info.title).toBe("[loop] Fix the failing tests in src/foo");
  });

  it("pauses as blocked when the agent signals it needs the user", async () => {
    state.results = [{ isError: false, resultText: "Need the DB password.\n<promise>BLOCKED</promise>" }];
    const h = (await startLoopRun("s2", base, "pwa")) as unknown as Started;
    expect(h.outcome).toEqual({ isError: false });
    expect(state.published.at(-1)).toEqual({ type: "loop_end", reason: "blocked", iterations: 1 });
    expect(state.turns).toHaveLength(1);
  });

  it("stops on error when asked and runs to the cap otherwise", async () => {
    state.results = [{ isError: true, resultText: "" }];
    await startLoopRun("s3", { ...base, stopOnError: true }, "pwa");
    expect(state.published.at(-1)).toMatchObject({ reason: "error", iterations: 1 });

    state.published.length = 0;
    state.turns.length = 0;
    await startLoopRun("s4", { ...base, maxIterations: 3, stopOnError: false }, "pwa");
    expect(state.turns).toHaveLength(3);
    expect(state.published.at(-1)).toMatchObject({ reason: "max", iterations: 3 });
  });

  it("resumes the conversation for pi, but resends the full task for agents that cannot resume", async () => {
    state.provider = "pi";
    await startLoopRun("s5", { ...base, maxIterations: 2 }, "pwa");
    expect(state.turns[1].prompt).not.toContain("<task>");

    state.turns.length = 0;
    state.provider = "codex";
    await startLoopRun("s6", { ...base, maxIterations: 2 }, "pwa");
    expect(state.turns[1].prompt).toContain("<task>");
  });

  it("reports stopped when aborted", async () => {
    state.ac.abort();
    await startLoopRun("s7", base, "pwa");
    expect(state.published.at(-1)).toMatchObject({ type: "loop_end", reason: "stopped", iterations: 0 });
  });
});
