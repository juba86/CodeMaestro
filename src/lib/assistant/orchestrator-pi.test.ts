import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { defaultOrchestraConfig, type OrchestraConfig } from "./orchestra-types";
import type { OrchEvent, Worker } from "./orchestrator";
import type { PiInfo, PiModel, PiSyncResult } from "./pi";

// pi workers in the orchestrator: discovery (pi installed / missing / Ollama
// outage), the runner rows pi subtasks run with, the sandbox restriction, the
// role auto-pick and the presets. Module boundaries (prisma, Ollama, chat
// providers, the CLI runner and pi itself) are mocked.

type TurnEmit = (e: { type: string; content?: string; isError?: boolean; costUsd?: number }) => void;
type TurnRow = Record<string, unknown> & { provider: string; model: string; permissionMode: string; allowedTools: string };

const state = vi.hoisted(() => ({
  ollama: [] as { id: string; name: string }[],
  piInfo: (async () => ({ installed: true, version: "1.0.0", bin: "pi" })) as () => Promise<PiInfo>,
  sync: null as null | (() => Promise<PiSyncResult>),
  piInfoCalls: 0,
  syncCalls: 0,
  turns: [] as { row: TurnRow; prompt: string; signal?: AbortSignal }[],
  turnImpl: null as null | ((row: TurnRow, prompt: string, emit: TurnEmit) => Promise<unknown>),
  chats: [] as string[],
  chatImpl: (() => "local text") as (prompt: string) => string,
  settings: new Map<string, string>(),
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    assistantSession: { update: async () => ({}) },
    setting: {
      findUnique: async ({ where }: { where: { key: string } }) => {
        const value = state.settings.get(where.key);
        return value === undefined ? null : { key: where.key, value };
      },
      upsert: async () => ({}),
    },
  },
}));
vi.mock("@/lib/ai/ollama-provider", () => ({
  fetchOllamaModels: async () => state.ollama.map((m) => ({ ...m, provider: "ollama", maxTokens: 8192 })),
}));
vi.mock("@/lib/ai/openai-compatible-provider", () => ({ fetchOpenAICompatModels: async () => [] }));
vi.mock("@/lib/ai/provider-factory", () => ({
  createProvider: () => ({
    streamMessage: async function* (p: { messages: { content: string }[] }) {
      const prompt = p.messages[0].content;
      state.chats.push(prompt);
      yield { type: "text", content: state.chatImpl(prompt) };
      yield { type: "done", content: "" };
    },
  }),
}));
vi.mock("./runner", () => ({
  isMarker: (id: string | null | undefined) => !!id && id.includes("~"),
  runTurn: async (row: TurnRow, prompt: string, _key: unknown, emit: TurnEmit, opts?: { signal?: AbortSignal }) => {
    state.turns.push({ row, prompt, signal: opts?.signal });
    return state.turnImpl!(row, prompt, emit);
  },
}));
vi.mock("./pi", () => ({
  piInfo: () => {
    state.piInfoCalls++;
    return state.piInfo();
  },
  syncOllamaModels: () => {
    state.syncCalls++;
    return state.sync!();
  },
}));

// --- Fixtures ---------------------------------------------------------------------

const piModel = (id: string, contextWindow: number, toolsOk = true): PiModel => ({
  id, name: id, toolsOk, reasoning: false, vision: false, contextWindow,
});
const MODELS = [piModel("qwen3-coder:30b", 32_768), piModel("gemma4:31b", 131_072), piModel("llava:7b", 4096, false)];
const synced = (models: PiModel[], error?: string): PiSyncResult => ({
  models, syncedAt: 1, ollamaBaseUrl: "http://ollama:11434", contextFallback: 32_768, ...(error ? { error } : {}),
});

const PI_CODER = "pi:qwen3-coder:30b";
const PI_GEMMA = "pi:gemma4:31b";
const CHAT_GEMMA = "ollama:gemma4:31b";

const session = {
  id: "s1", externalId: null, provider: "claude", model: "", cwd: "/tmp/proj",
  permissionMode: "acceptEdits", allowedTools: "Read,Edit,Bash", approvalMode: "edits", sandbox: false,
};
const sandboxed = { ...session, approvalMode: "off", sandbox: true };

function fakeBinDir(bins: string[]): string {
  const d = mkdtempSync(path.join(tmpdir(), "orch-pi-bins-"));
  for (const b of bins) {
    const f = path.join(d, b);
    writeFileSync(f, "#!/bin/sh\n");
    chmodSync(f, 0o755);
  }
  return d;
}

const ORIGINAL_PATH = process.env.PATH;

async function loadOrchestrator(bins: string[] = []) {
  vi.resetModules();
  delete (globalThis as { __cmOrchCaches?: unknown }).__cmOrchCaches;
  process.env.PATH = fakeBinDir(bins);
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  return import("./orchestrator");
}

function collector() {
  const events: OrchEvent[] = [];
  const rows: { role: string; content: string; meta?: string }[] = [];
  return {
    events,
    rows,
    io: {
      emit: (e: OrchEvent) => { events.push(e); },
      record: (r: { role: string; content: string; meta?: string }) => { rows.push(r); },
    },
  };
}

const ids = (ws: Worker[]) => ws.map((w) => w.id);
const workerOf = (c: OrchestraConfig, id: string) => c.roles.find((r) => r.id === id)?.workerId;
const isPlanner = (p: string) => p.includes("orchestration planner");
const isReview = (p: string) => p.includes("Review round");

beforeEach(() => {
  state.ollama = MODELS.map((m) => ({ id: m.id, name: m.id }));
  state.piInfo = async () => ({ installed: true, version: "1.0.0", bin: "pi" });
  state.sync = async () => synced(MODELS);
  state.piInfoCalls = 0;
  state.syncCalls = 0;
  state.turns = [];
  state.chats = [];
  state.chatImpl = () => "local text";
  state.turnImpl = async (_row, _prompt, emit) => {
    emit({ type: "text", content: "done" });
    return { externalId: null, costUsd: 0, isError: false };
  };
});
afterEach(() => { vi.useRealTimers(); });
afterAll(() => { process.env.PATH = ORIGINAL_PATH; });

// --- Discovery --------------------------------------------------------------------

describe("pi worker discovery", () => {
  it("adds a file-editing pi agent per tool-capable model; the others stay text-only Ollama workers", async () => {
    const o = await loadOrchestrator(["claude"]);
    const all = await o.discoverAllWorkers();
    expect(ids(all)).toEqual([
      "claude",
      "ollama:qwen3-coder:30b", CHAT_GEMMA, "ollama:llava:7b",
      PI_CODER, PI_GEMMA,
    ]);
    const coder = all.find((w) => w.id === PI_CODER)!;
    expect(o.toWorkerInfo(coder)).toMatchObject({
      id: PI_CODER, kind: "pi", label: "pi · qwen3-coder:30b", editsFiles: true, local: true, model: "qwen3-coder:30b",
    });
    expect(coder.strengths).toMatch(/free, runs offline/);
    expect(coder.strengths).toMatch(/edits project files/);
    expect(coder.strengths).toContain("Coding specialist.");
    expect(coder.strengths).toContain("Context ~32k tokens");
    expect(all.find((w) => w.id === PI_GEMMA)!.strengths).toContain("Context ~128k tokens");

    // The execution pool carries every pi agent next to the curated chat pair.
    expect(ids(await o.discoverWorkers())).toEqual(["claude", "ollama:qwen3-coder:30b", CHAT_GEMMA, PI_CODER, PI_GEMMA]);
    // Memoized: one pi probe and one sync for all of the above.
    expect([state.piInfoCalls, state.syncCalls]).toEqual([1, 1]);
  });

  it("pi not installed: no pi workers and no model sync", async () => {
    state.piInfo = async () => ({ installed: false, version: null, bin: "pi", error: "pi nicht gefunden" });
    const o = await loadOrchestrator(["claude"]);
    expect(ids(await o.discoverAllWorkers())).toEqual(["claude", "ollama:qwen3-coder:30b", CHAT_GEMMA, "ollama:llava:7b"]);
    expect(state.syncCalls).toBe(0);
  });

  it("an Ollama outage drops the pi agents (the sync's last good list is not reachable either)", async () => {
    state.ollama = [];
    state.sync = async () => synced(MODELS, "Ollama nicht erreichbar (http://ollama:11434): fetch failed");
    const o = await loadOrchestrator(["claude"]);
    expect(ids(await o.discoverAllWorkers())).toEqual(["claude"]);
  });

  it("failing pi probes or syncs never break discovery", async () => {
    state.piInfo = async () => { throw new Error("spawn EACCES"); };
    let o = await loadOrchestrator(["claude"]);
    expect(ids(await o.discoverAllWorkers())).toEqual(["claude", "ollama:qwen3-coder:30b", CHAT_GEMMA, "ollama:llava:7b"]);

    state.piInfo = async () => ({ installed: true, version: "1.0.0", bin: "pi" });
    state.sync = async () => { throw new Error("boom"); };
    o = await loadOrchestrator(["claude"]);
    expect(ids(await o.discoverWorkers())).toEqual(["claude", "ollama:qwen3-coder:30b", CHAT_GEMMA]);
  });

  it("a hanging pi sync times out instead of stalling discovery", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    state.sync = () => new Promise<PiSyncResult>(() => {});
    const o = await loadOrchestrator(["claude"]);
    const pending = o.discoverAllWorkers();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(ids(await pending)).toEqual(["claude", "ollama:qwen3-coder:30b", CHAT_GEMMA, "ollama:llava:7b"]);
  });
});

// --- Execution --------------------------------------------------------------------

describe("pi execution", () => {
  it("runs a pi subtask as an agent with the session's mode, tools and approval gate", async () => {
    const o = await loadOrchestrator([]);
    state.turnImpl = async (_row, _prompt, emit) => {
      emit({ type: "text", content: "edited src/a.ts" });
      return { externalId: "cm-s1-x", costUsd: 0, isError: false };
    };
    const c = collector();
    const res = await o.executePlan(session, "task",
      [{ id: "s1", title: "Umsetzen", description: "build it", workerId: PI_CODER, dependsOn: [], editsFiles: true }],
      c.io);

    expect(res).toEqual({ costUsd: 0, isError: false, stopped: false });
    expect(state.turns).toHaveLength(1);
    expect(state.turns[0].row).toEqual({
      id: "s1", externalId: null, forkSession: false, ephemeral: true, provider: "pi", model: "qwen3-coder:30b", cwd: "/tmp/proj",
      // The session's tools + pi's read tools + Write (acceptEdits / the gate let Claude write as well).
      permissionMode: "acceptEdits", allowedTools: "Read,Edit,Bash,Grep,Glob,Write", approvalMode: "edits", sandbox: false, interactive: true,
    });
    expect(c.events.find((e) => e.type === "subtask_start")).toMatchObject({ workerId: PI_CODER, workerLabel: "pi · qwen3-coder:30b" });
    expect(c.events.filter((e) => e.type === "subtask_text").map((e) => e.content).join("")).toBe("edited src/a.ts");
    // No notes: pi enforces the approval gate itself.
    expect(c.rows.filter((r) => r.role === "system")).toEqual([]);
    // The summary runs on the local chat model (the Auto conductor).
    expect(c.events.find((e) => e.type === "log" && e.content?.startsWith("Zusammenfassung"))!.content).toBe("Zusammenfassung: Local: gemma4:31b");
  });

  it("Stop reaches a running pi worker (run signal + the session's process key) and ends the run", async () => {
    const o = await loadOrchestrator([]);
    const ac = new AbortController();
    state.turnImpl = async (_row, _prompt, emit) => {
      ac.abort(); // the user presses Stop while pi works
      emit({ type: "error", content: "Gestoppt." });
      return { externalId: null, costUsd: 0, isError: true };
    };
    const c = collector();
    const res = await o.executePlan(session, "task", [
      { id: "s1", title: "A", description: "a", workerId: PI_CODER, dependsOn: [], editsFiles: true },
      { id: "s2", title: "B", description: "b", workerId: PI_CODER, dependsOn: ["s1"], editsFiles: true },
    ], { ...c.io, signal: ac.signal });
    expect(res.stopped).toBe(true);
    // One pi turn, keyed by the session id (stopSession kills it) and given the run's signal.
    expect(state.turns).toHaveLength(1);
    expect(state.turns[0].row).toMatchObject({ id: "s1", provider: "pi" });
    expect(state.turns[0].signal).toBe(ac.signal);
    expect(state.chats).toEqual([]); // no summary after Stop
  });

  it("text runs (planning, review) use pi read-only: plan mode with read tools and no gate", async () => {
    const o = await loadOrchestrator([]);
    state.turnImpl = async (_row, prompt, emit) => {
      emit({ type: "text", content: isReview(prompt) ? "<verdict>pass</verdict>" : isPlanner(prompt) ? "narrated" : "done" });
      return { externalId: null, costUsd: 0, isError: false };
    };
    const orchestra = defaultOrchestraConfig();
    orchestra.conductor.workerId = PI_GEMMA;
    orchestra.roles.find((r) => r.id === "reviewer")!.workerId = PI_GEMMA;

    await o.planSubtasks(session, "t", { orchestra });
    const planner = state.turns.find((t) => isPlanner(t.prompt))!;
    expect(planner.row).toEqual({
      id: "s1", externalId: null, forkSession: false, ephemeral: true, provider: "pi", model: "gemma4:31b", cwd: "/tmp/proj", permissionMode: "plan", allowedTools: "Read,Grep,Glob",
    });

    state.turns = [];
    const c = collector();
    await o.executePlan(session, "task",
      [{ id: "s1", title: "Umsetzen", description: "build it", workerId: PI_CODER, dependsOn: [], editsFiles: true, roleId: "coder" }],
      c.io, { orchestra });
    const review = state.turns.find((t) => isReview(t.prompt))!;
    expect(review.row).toMatchObject({ provider: "pi", model: "gemma4:31b", permissionMode: "plan", allowedTools: "Read,Grep,Glob" });
    expect(review.row.approvalMode).toBeUndefined();
    expect(review.row.sandbox).toBeUndefined();
    // A pi reviewer can open the project, so it is asked to check the files.
    expect(review.prompt).toContain("Read the affected files");
    expect(c.events.find((e) => e.type === "review_end")).toMatchObject({ verdict: "pass" });
  });

  it("a pi editor gets the tools Claude Code may use in the session (pi itself never asks)", async () => {
    const o = await loadOrchestrator([]);
    const rowFor = async (s: Partial<typeof session>) => {
      state.turns = [];
      await o.executePlan({ ...session, ...s }, "task",
        [{ id: "s1", title: "Umsetzen", description: "build it", workerId: PI_CODER, dependsOn: [], editsFiles: true }],
        collector().io);
      return state.turns[0].row;
    };
    const base = { permissionMode: "default", allowedTools: "Read,Grep,Glob", approvalMode: "off" };
    // Claude Code edits nothing headless here either.
    expect((await rowFor(base)).allowedTools).toBe("Read,Grep,Glob");
    // pi has no implicit read tools; the session's own list is kept.
    expect((await rowFor({ ...base, allowedTools: "Bash(git *)" })).allowedTools).toBe("Bash(git *),Read,Grep,Glob");
    // Under the gate pi's extension asks for every edit (and, in "all", every command).
    expect(await rowFor({ ...base, approvalMode: "edits" })).toMatchObject({ allowedTools: "Read,Grep,Glob,Edit,Write", approvalMode: "edits" });
    expect(await rowFor({ ...base, approvalMode: "all" })).toMatchObject({ allowedTools: "Read,Grep,Glob,Edit,Write,Bash", approvalMode: "all" });
    // Edits that need no confirmation; commands only with bypassPermissions.
    for (const permissionMode of ["acceptEdits", "auto"]) {
      expect((await rowFor({ ...base, permissionMode })).allowedTools).toBe("Read,Grep,Glob,Edit,Write");
    }
    expect((await rowFor({ ...base, permissionMode: "bypassPermissions" })).allowedTools).toBe("Read,Grep,Glob,Edit,Write,Bash");
    expect((await rowFor({ ...base, permissionMode: "dontAsk" })).allowedTools).toBe("Read,Grep,Glob");
    // Plan mode stays plan mode (the runner then keeps only pi's read tools).
    expect(await rowFor({ ...base, permissionMode: "plan", approvalMode: "all" })).toMatchObject({ permissionMode: "plan" });
  });

  it("a subtask that changes no files runs pi read-only, even where pi could edit", async () => {
    const o = await loadOrchestrator([]);
    await o.executePlan(session, "task", [
      { id: "s1", title: "Lesen", description: "look", workerId: PI_GEMMA, dependsOn: [], editsFiles: false },
      { id: "s2", title: "Umsetzen", description: "build", workerId: PI_GEMMA, dependsOn: [], editsFiles: true },
    ], collector().io);
    const turn = (p: string) => state.turns.find((t) => t.prompt.startsWith(p))!;
    // Plan mode: the runner drops bash/edit/write; the gate stays loaded.
    expect(turn("look").row).toMatchObject({
      provider: "pi", permissionMode: "plan", allowedTools: "Read,Grep,Glob", approvalMode: "edits", sandbox: false, interactive: false,
    });
    expect(turn("look").prompt).toContain("with read-only access");
    expect(turn("build").row).toMatchObject({ provider: "pi", permissionMode: "acceptEdits", approvalMode: "edits" });
    expect(turn("build").row.allowedTools.split(",")).toEqual(expect.arrayContaining(["Edit", "Write"]));
    expect(turn("build").prompt).not.toContain("read-only");
  });

  it("read-only Gemini under the approval gate runs without the gate it cannot enforce (read tools only)", async () => {
    const o = await loadOrchestrator(["claude", "gemini"]);
    process.env.GEMINI_API_KEY = "k"; // gemini-cli counts as logged in
    const c = collector();
    try {
      await o.executePlan({ ...session, allowedTools: "Read,Edit,Bash,WebSearch" }, "task",
        [{ id: "s1", title: "Lesen", description: "look", workerId: "gemini", dependsOn: [], editsFiles: false }],
        c.io);
    } finally {
      delete process.env.GEMINI_API_KEY;
    }
    // The runner refuses Gemini with a gate set, so the row must not carry it.
    expect(state.turns[0].row).toEqual({
      id: "s1", externalId: null, forkSession: false, ephemeral: true, provider: "gemini", model: "", cwd: "/tmp/proj",
      permissionMode: "default", allowedTools: "Read,WebSearch", approvalMode: "off", sandbox: false, interactive: false,
    });
    expect(c.rows.filter((r) => r.role === "system").map((r) => r.content)).toEqual([
      "Gemini CLI läuft schreibgeschützt: Freigabe-Modus bzw. Sandbox lassen sich für Gemini nicht erzwingen.",
    ]);
  });

  it("every worker row passes the runner's fail-closed checks (gate and sandbox only where enforceable)", async () => {
    const runner = await vi.importActual<typeof import("./runner")>("./runner");
    const o = await loadOrchestrator(["claude", "gemini"]);
    process.env.GEMINI_API_KEY = "k";
    try {
      for (const s of [session, sandboxed, { ...session, approvalMode: "all", sandbox: true }]) {
        state.turns = [];
        await o.executePlan(s, "task", [
          { id: "s1", title: "A", description: "a", workerId: PI_CODER, dependsOn: [], editsFiles: true },
          { id: "s2", title: "B", description: "b", workerId: PI_GEMMA, dependsOn: [], editsFiles: false },
          { id: "s3", title: "C", description: "c", workerId: "gemini", dependsOn: [], editsFiles: false },
        ], collector().io);
        expect(state.turns.length).toBeGreaterThanOrEqual(3);
        for (const { row } of state.turns) {
          const gate = typeof row.approvalMode === "string" && row.approvalMode !== "off";
          expect(gate && !runner.supportsApprovalGate(row.provider), `${row.provider} with gate`).toBe(false);
          expect(!!row.sandbox && !runner.supportsSandbox(row.provider), `${row.provider} with sandbox`).toBe(false);
        }
      }
    } finally {
      delete process.env.GEMINI_API_KEY;
    }
  });

  it("canEditFiles: pi edits under the approval gate, but not in a sandbox", async () => {
    const o = await loadOrchestrator([]);
    const pi = (await o.discoverWorkers()).find((w) => w.id === PI_CODER)!;
    const gemini: Worker = { id: "gemini", kind: "gemini-cli", model: "", label: "Gemini CLI", strengths: "", editsFiles: true };
    for (const approvalMode of ["off", "edits", "all"]) {
      expect(o.canEditFiles(pi, { ...session, approvalMode })).toBe(true);
    }
    expect(o.canEditFiles(pi, sandboxed)).toBe(false);
    expect(o.canEditFiles(pi, { ...sandboxed, approvalMode: "all" })).toBe(false);
    // Unchanged for Gemini: read-only under the gate or the sandbox.
    expect(o.canEditFiles(gemini, session)).toBe(false);
    expect(o.canEditFiles(gemini, { ...session, approvalMode: "off" })).toBe(true);
  });

  it("sandboxed session: file work moves off pi with a notice; pi keeps read-only work", async () => {
    const o = await loadOrchestrator(["claude"]);
    const c = collector();
    await o.executePlan(sandboxed, "task", [
      { id: "s1", title: "Umsetzen", description: "build", workerId: PI_CODER, dependsOn: [], editsFiles: true },
      { id: "s2", title: "Lesen", description: "look", workerId: PI_GEMMA, dependsOn: [], editsFiles: false },
    ], c.io);

    const notices = c.rows.filter((r) => r.role === "system").map((r) => r.content);
    expect(notices).toEqual([
      "„Umsetzen“ ändert Dateien, pi · qwen3-coder:30b kann das nicht — übernimmt Claude Code.",
      "pi (lokale Modelle) läuft in Sandbox-Sessions schreibgeschützt: die Sandbox lässt sich für pi nicht erzwingen.",
    ]);
    const [work, read] = state.turns.filter((t) => t.prompt.startsWith("build") || t.prompt.startsWith("look"));
    expect(work.row).toMatchObject({ provider: "claude", sandbox: true, permissionMode: "acceptEdits" });
    // Read-only pi: plan mode drops bash/edit/write; the runner refuses pi with the sandbox flag.
    expect(read.row).toMatchObject({
      provider: "pi", model: "gemma4:31b", permissionMode: "plan", allowedTools: "Read,Grep,Glob", sandbox: false, approvalMode: "off",
    });
  });

  it("sandboxed session without another editor: the subtask stays on pi read-only and says so", async () => {
    const o = await loadOrchestrator([]);
    const c = collector();
    await o.executePlan(sandboxed, "task",
      [{ id: "s1", title: "Umsetzen", description: "build", workerId: PI_CODER, dependsOn: [], editsFiles: true }],
      c.io);
    expect(c.rows.filter((r) => r.role === "system").map((r) => r.content)).toEqual([
      "⚠ „Umsetzen“ soll Dateien ändern, aber kein Worker mit Dateizugriff ist verfügbar — pi · qwen3-coder:30b liefert nur Text, es werden keine Dateien geändert.",
      "pi (lokale Modelle) läuft in Sandbox-Sessions schreibgeschützt: die Sandbox lässt sich für pi nicht erzwingen.",
    ]);
    expect(state.turns[0].row).toMatchObject({ provider: "pi", permissionMode: "plan", sandbox: false });
  });
});

// --- Role auto-pick and presets ---------------------------------------------------

describe("roles and presets with pi", () => {
  const rolePlan = JSON.stringify({ subtasks: [
    { id: "s1", title: "Entwurf", roleId: "architekt", description: "design", dependsOn: [] },
    { id: "s2", title: "Umsetzen", roleId: "coder", description: "build", dependsOn: ["s1"] },
    { id: "s3", title: "Testen", roleId: "tester", description: "test", dependsOn: ["s2"] },
  ] });

  it("Auto: file-editing roles take a pi agent over text-only local models; text roles stay on the chat conductor", async () => {
    const o = await loadOrchestrator([]);
    state.chatImpl = (p) => (isPlanner(p) ? rolePlan : "x");
    const logs: string[] = [];
    const res = await o.planSubtasks(session, "Baue X", { orchestra: defaultOrchestraConfig(), onLog: (m) => logs.push(m) });
    expect(logs).toContain("Planer (Auto): Local: gemma4:31b");
    expect(res.subtasks.map((s) => [s.roleId, s.workerId, s.editsFiles])).toEqual([
      ["architekt", CHAT_GEMMA, false],
      ["coder", PI_GEMMA, true],
      ["tester", PI_GEMMA, true],
    ]);
  });

  it("Auto in a sandboxed session: no pi editor, so editing roles fall back to text with a notice", async () => {
    const o = await loadOrchestrator([]);
    state.chatImpl = (p) => (isPlanner(p) ? rolePlan : "x");
    const logs: string[] = [];
    const res = await o.planSubtasks(sandboxed, "Baue X", { orchestra: defaultOrchestraConfig(), onLog: (m) => logs.push(m) });
    expect(res.subtasks.find((s) => s.roleId === "coder")!.workerId).toBe(CHAT_GEMMA);
    expect(logs).toContain(
      "⚠ „Umsetzen“ soll Dateien ändern, aber kein Worker mit Dateizugriff ist verfügbar — Local: gemma4:31b liefert nur Text, es werden keine Dateien geändert."
    );
    expect(logs).toContain("pi (lokale Modelle) läuft in Sandbox-Sessions schreibgeschützt: die Sandbox lässt sich für pi nicht erzwingen.");
  });

  it("the role-less planner sees the best pi coder and the best general pi agent only", async () => {
    state.ollama.push({ id: "llama3.1:8b", name: "llama3.1:8b" });
    state.sync = async () => synced([...MODELS, piModel("llama3.1:8b", 8192)]);
    const o = await loadOrchestrator([]);
    state.chatImpl = (p) => (isPlanner(p) ? JSON.stringify({ subtasks: [
      { id: "s1", title: "A", description: "a", workerId: "pi:llama3.1:8b", dependsOn: [], editsFiles: true },
    ] }) : "x");
    const res = await o.planSubtasks(session, "t");
    const prompt = state.chats.find(isPlanner)!;
    expect(prompt).toContain(`- ${PI_CODER} (pi · qwen3-coder:30b, editsFiles=true)`);
    expect(prompt).toContain(`- ${PI_GEMMA} (pi · gemma4:31b, editsFiles=true)`);
    expect(prompt).not.toContain("- pi:llama3.1:8b");
    // Any discovered pi agent still runs when assigned.
    expect(res.subtasks[0].workerId).toBe("pi:llama3.1:8b");
    const llama = (await o.discoverWorkers()).find((w) => w.id === "pi:llama3.1:8b")!;
    expect(llama.strengths).toContain("Small context (~8k tokens), so only for tiny, single-file changes.");
  });

  it("presets with local models only: pi agents for the editing roles, the chat model for the rest", async () => {
    await loadOrchestrator([]);
    const { generatePreset } = await import("./orchestra");
    const local = await generatePreset("local");
    expect(local.warnings).toEqual([]);
    expect(local.config.conductor.workerId).toBe(CHAT_GEMMA);
    expect(workerOf(local.config, "coder")).toBe(PI_GEMMA);
    expect(workerOf(local.config, "tester")).toBe(PI_GEMMA);
    expect(workerOf(local.config, "doku")).toBe(PI_GEMMA);
    for (const role of ["architekt", "reviewer", "recherche"]) expect(workerOf(local.config, role)).toBe(CHAT_GEMMA);

    for (const preset of ["balanced", "quality"] as const) {
      const r = await generatePreset(preset);
      expect(r.warnings).toEqual([]);
      expect(workerOf(r.config, "coder")).toBe(PI_GEMMA);
      expect(workerOf(r.config, "tester")).toBe(PI_GEMMA);
      expect(workerOf(r.config, "architekt")).toBe(CHAT_GEMMA);
    }
  });

  it("balanced with Claude: Claude designs and reviews, a pi agent implements and tests", async () => {
    await loadOrchestrator(["claude"]);
    const { generatePreset } = await import("./orchestra");
    const { config: c, warnings } = await generatePreset("balanced");
    expect(warnings).toEqual([]);
    expect(c.conductor.workerId).toBe("claude");
    expect(workerOf(c, "architekt")).toBe("claude");
    expect(workerOf(c, "reviewer")).toBe("claude");
    expect(workerOf(c, "coder")).toBe(PI_GEMMA);
    expect(workerOf(c, "tester")).toBe(PI_GEMMA);
  });
});
