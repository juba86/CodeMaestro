import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { orchestrateRunSchema } from "@/lib/validation/schemas";
import { ORCHESTRA_LIMITS, defaultOrchestraConfig, type OrchestraConfig } from "./orchestra-types";
import type { OrchEvent } from "./orchestrator";

// The orchestrator's CLI path (runCli): how streamed text is assembled, which
// access a subtask runs with, and the planner's id limits. The CLI runner is
// mocked at its module boundary, so every text event goes through the real
// runCli / plan / executePlan code.

type TurnEvent = { type: string; content?: string; name?: string; input?: unknown; toolUseId?: string; isError?: boolean };
type TurnEmit = (e: TurnEvent) => void;
type TurnRow = Record<string, unknown> & { provider: string; permissionMode: string; allowedTools: string };

const state = vi.hoisted(() => ({
  ollama: [] as { id: string; name: string }[],
  turns: [] as { row: TurnRow; prompt: string }[],
  turnImpl: null as null | ((row: TurnRow, prompt: string, emit: TurnEmit) => Promise<unknown>),
  chatImpl: (() => "local text") as (prompt: string) => string,
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    assistantSession: { update: async () => ({}) },
    setting: { findUnique: async () => null, upsert: async () => ({}) },
  },
}));
vi.mock("@/lib/ai/ollama-provider", () => ({
  fetchOllamaModels: async () => state.ollama.map((m) => ({ ...m, provider: "ollama", maxTokens: 8192 })),
}));
vi.mock("@/lib/ai/openai-compatible-provider", () => ({ fetchOpenAICompatModels: async () => [] }));
vi.mock("@/lib/ai/provider-factory", () => ({
  createProvider: () => ({
    streamMessage: async function* (p: { messages: { content: string }[] }) {
      yield { type: "text", content: state.chatImpl(p.messages[0].content) };
      yield { type: "done", content: "" };
    },
  }),
}));
vi.mock("./runner", () => ({
  runTurn: async (row: TurnRow, prompt: string, _key: unknown, emit: TurnEmit) => {
    state.turns.push({ row, prompt });
    return state.turnImpl!(row, prompt, emit);
  },
}));
vi.mock("./pi", () => ({
  piInfo: async () => ({ installed: false, version: null, bin: "pi" }),
  syncOllamaModels: async () => ({ models: [], syncedAt: null, ollamaBaseUrl: "", contextFallback: 32768 }),
}));

// --- Fixtures ---------------------------------------------------------------------

const session = {
  id: "s1", externalId: null, provider: "claude", model: "", cwd: "/tmp/proj",
  permissionMode: "acceptEdits", allowedTools: "Read,Edit,Bash", approvalMode: "off", sandbox: false,
};

function fakeBinDir(bins: string[]): string {
  const d = mkdtempSync(path.join(tmpdir(), "orch-cli-bins-"));
  for (const b of bins) {
    const f = path.join(d, b);
    writeFileSync(f, "#!/bin/sh\n");
    chmodSync(f, 0o755);
  }
  return d;
}

const ORIGINAL_PATH = process.env.PATH;

async function loadOrchestrator(bins: string[]) {
  vi.resetModules();
  delete (globalThis as { __cmOrchCaches?: unknown }).__cmOrchCaches;
  process.env.PATH = fakeBinDir(bins);
  if (bins.includes("gemini")) process.env.GEMINI_API_KEY = "k";
  else delete process.env.GEMINI_API_KEY;
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

/** Emits `text` as many small text events, like the runner's coalesced token deltas. */
function streamText(emit: TurnEmit, text: string, size = 4) {
  for (let i = 0; i < text.length; i += size) emit({ type: "text", content: text.slice(i, i + size) });
}

const ok = { externalId: null, costUsd: 0, isError: false };
const isPlanner = (p: string) => p.includes("orchestration planner");
const isReview = (p: string) => p.includes("Review round");
const isFix = (p: string) => p.includes("reviewed your work");
const isSynthesis = (p: string) => p.startsWith("You orchestrated");
const joined = (events: OrchEvent[], type: OrchEvent["type"]) => events.filter((e) => e.type === type).map((e) => e.content).join("");

function config(mutate: (c: OrchestraConfig) => void = () => {}): OrchestraConfig {
  const c = defaultOrchestraConfig();
  mutate(c);
  return c;
}

beforeEach(() => {
  state.ollama = [];
  state.turns = [];
  state.chatImpl = () => "local text";
  state.turnImpl = async (_row, _prompt, emit) => {
    emit({ type: "text", content: "done" });
    return ok;
  };
});
afterAll(() => {
  process.env.PATH = ORIGINAL_PATH;
  delete process.env.GEMINI_API_KEY;
});

// --- Streamed text ----------------------------------------------------------------

describe("streamed CLI text", () => {
  it("joins token chunks verbatim, so a plan split inside its JSON strings still parses", async () => {
    const o = await loadOrchestrator(["claude"]);
    const plan = JSON.stringify({ subtasks: [
      { id: "s1", title: "Entwurf", roleId: "architekt", description: "Schnittstellen festlegen", dependsOn: [] },
      { id: "s2", title: "Umsetzen", roleId: "coder", description: "Feature bauen", dependsOn: ["s1"] },
    ] });
    state.turnImpl = async (_row, prompt, emit) => {
      if (isPlanner(prompt)) streamText(emit, plan, 3); // cuts "Entwurf", "Schnittstellen", …
      return ok;
    };
    const logs: string[] = [];
    const res = await o.planSubtasks(session, "Baue X", { orchestra: defaultOrchestraConfig(), onLog: (m) => logs.push(m) });

    expect(logs.some((m) => m.includes("kein gültiges JSON"))).toBe(false);
    expect(res.subtasks.map((s) => [s.id, s.title, s.roleId, s.description])).toEqual([
      ["s1", "Entwurf", "architekt", "Schnittstellen festlegen"],
      ["s2", "Umsetzen", "coder", "Feature bauen"],
    ]);
  });

  it("reads a <verdict> tag split across chunks and keeps subtask and summary text intact", async () => {
    const o = await loadOrchestrator(["claude"]);
    state.turnImpl = async (_row, prompt, emit) => {
      if (isReview(prompt)) {
        for (const c of ["Keine Lücken.\n<ver", "dict>pa", "ss</ver", "dict>"]) emit({ type: "text", content: c });
      } else if (isSynthesis(prompt)) {
        streamText(emit, "Feature X ist umgesetzt.");
      } else {
        // Text, a tool call, more text: the only real block boundary.
        streamText(emit, "Hallo Welt, ich lese src/a.ts.");
        emit({ type: "tool_use", name: "Read", input: { file_path: "src/a.ts" }, toolUseId: "t1" });
        emit({ type: "tool_result", toolUseId: "t1", content: "…" });
        streamText(emit, "Erledigt.");
      }
      return ok;
    };
    const c = collector();
    await o.executePlan(session, "task",
      [{ id: "s1", title: "Umsetzen", description: "build it", workerId: "claude", dependsOn: [], editsFiles: true, roleId: "coder" }],
      c.io, { orchestra: defaultOrchestraConfig() });

    const work = "Hallo Welt, ich lese src/a.ts.\n\nErledigt.";
    expect(joined(c.events, "subtask_text")).toBe(work);
    expect(joined(c.events, "review_text")).toBe("Keine Lücken.\n<verdict>pass</verdict>");
    expect(c.events.find((e) => e.type === "review_end")).toMatchObject({ verdict: "pass" });
    expect(state.turns.some((t) => isFix(t.prompt))).toBe(false);
    expect(joined(c.events, "synthesis")).toBe("Feature X ist umgesetzt.");

    expect(c.rows.filter((r) => r.role === "system")).toEqual([]); // no "ohne eindeutiges Urteil"
    expect(c.rows.find((r) => r.role === "assistant")!.content).toBe(work);
    expect(c.rows.find((r) => r.role === "synthesis")!.content).toBe("Feature X ist umgesetzt.");
    // The reviewer saw the report as it was written.
    expect(state.turns.find((t) => isReview(t.prompt))!.prompt).toContain(`<report>\n${work}\n</report>`);
  });

  it("starts a new paragraph after thinking or tool events only, without doubling line breaks", async () => {
    const o = await loadOrchestrator(["claude"]);
    state.turnImpl = async (_row, _prompt, emit) => {
      emit({ type: "thinking", content: "hmm" }); // before any text: no leading break
      emit({ type: "text", content: "Eins\n" });
      emit({ type: "tool_use", name: "Grep", input: {}, toolUseId: "t1" });
      emit({ type: "text", content: "Zwei\n\n" });
      emit({ type: "thinking", content: "…" });
      emit({ type: "text", content: "Drei" });
      emit({ type: "text", content: "" });
      emit({ type: "text", content: " und vier" });
      emit({ type: "tool_result", toolUseId: "t2", content: "" });
      emit({ type: "text", content: "\nFünf" }); // brings one newline itself
      return ok;
    };
    const c = collector();
    await o.executePlan(session, "task",
      [{ id: "s1", title: "A", description: "a", workerId: "claude", dependsOn: [], editsFiles: true }], c.io);
    expect(joined(c.events, "subtask_text")).toBe("Eins\n\nZwei\n\nDrei und vier\n\nFünf");
  });

  it("a whole orchestration on chunked streams: the fenced plan parses and a split <verdict>changes</verdict> starts the fix round", async () => {
    const o = await loadOrchestrator(["claude"]);
    const plan = "```json\n" + JSON.stringify({ subtasks: [
      { id: "s1", title: "Umsetzen", roleId: "coder", description: "Feature „X“ bauen", dependsOn: [] },
    ] }) + "\n```";
    let reviews = 0;
    state.turnImpl = async (_row, prompt, emit) => {
      if (isPlanner(prompt)) streamText(emit, plan, 5);
      else if (isReview(prompt)) streamText(emit, ++reviews === 1 ? "Test fehlt.\n<verdict>changes</verdict>" : "Passt.\n<verdict>pass</verdict>", 3);
      else if (isFix(prompt)) streamText(emit, "Test ergänzt.");
      else if (isSynthesis(prompt)) streamText(emit, "Fertig.");
      else streamText(emit, "Gebaut.");
      return ok;
    };
    const c = collector();
    const res = await o.orchestrate(session, "Baue X", c.io, { orchestra: defaultOrchestraConfig() });

    expect(res).toMatchObject({ isError: false, stopped: false });
    expect(c.events.some((e) => e.type === "log" && e.content?.includes("als eine Teilaufgabe"))).toBe(false);
    expect(c.events.find((e) => e.type === "plan")!.subtasks!.map((s) => [s.id, s.roleId, s.description])).toEqual([
      ["s1", "coder", "Feature „X“ bauen"],
    ]);
    expect(c.events.filter((e) => e.type === "review_end").map((e) => e.verdict)).toEqual(["changes", "pass"]);
    expect(state.turns.filter((t) => isFix(t.prompt))).toHaveLength(1);
    // The fix round's findings are the review as written.
    expect(state.turns.find((t) => isFix(t.prompt))!.prompt).toContain("Test fehlt.\n<verdict>changes</verdict>");
    // The coder's fix round keeps the session's write access (and is not told otherwise).
    expect(state.turns.find((t) => isFix(t.prompt))!.row).toMatchObject({ permissionMode: "acceptEdits", allowedTools: "Read,Edit,Bash" });
    expect(state.turns.find((t) => isFix(t.prompt))!.prompt).not.toContain("read-only");
    expect(joined(c.events, "subtask_text")).toBe("Gebaut.\n\nTest ergänzt.");
    expect(joined(c.events, "synthesis")).toBe("Fertig.");
  });
});

// --- Read-only subtasks -----------------------------------------------------------

describe("subtasks that change no files", () => {
  const gated = { ...session, allowedTools: "Read,Edit,Bash,WebFetch", approvalMode: "edits", sandbox: true };

  it("run read-only on Claude Code (plan mode, read tools); editing subtasks keep the session's access", async () => {
    const o = await loadOrchestrator(["claude"]);
    const orchestra = config((c) => {
      for (const r of c.roles) r.reviewLoop.enabled = false;
    });
    await o.executePlan(gated, "task", [
      { id: "s1", title: "Entwurf", description: "design it", workerId: "claude", dependsOn: [], editsFiles: false, roleId: "architekt" },
      { id: "s2", title: "Umsetzen", description: "build it", workerId: "claude", dependsOn: ["s1"], editsFiles: true, roleId: "coder" },
      { id: "s3", title: "Erklären", description: "explain it", workerId: "claude", dependsOn: [], editsFiles: false },
    ], collector().io, { orchestra });

    const turn = (text: string) => state.turns.find((t) => t.prompt.includes(text))!;
    const readOnly = {
      id: "s1", externalId: null, provider: "claude", model: "", cwd: "/tmp/proj",
      permissionMode: "plan", allowedTools: "Read,WebFetch", approvalMode: "off", sandbox: true, interactive: false,
    };
    expect(turn("design it").row).toEqual(readOnly);
    expect(turn("explain it").row).toEqual(readOnly); // role-less: the subtask's flag decides
    expect(turn("build it").row).toEqual({
      ...readOnly, permissionMode: "acceptEdits", allowedTools: "Read,Edit,Bash,WebFetch", approvalMode: "edits",
    });
    expect(turn("design it").prompt).toContain("with read-only access");
    expect(turn("build it").prompt).not.toContain("read-only");
  });

  it("the fix round of a read-only role runs read-only as well", async () => {
    const o = await loadOrchestrator(["claude"]);
    let reviews = 0;
    state.turnImpl = async (_row, prompt, emit) => {
      if (isReview(prompt)) emit({ type: "text", content: ++reviews === 1 ? "fehlt\n<verdict>changes</verdict>" : "<verdict>pass</verdict>" });
      else emit({ type: "text", content: "Plan" });
      return ok;
    };
    const orchestra = config((c) => {
      c.roles.find((r) => r.id === "architekt")!.reviewLoop = { enabled: true, reviewerRoleId: "reviewer", maxRounds: 2 };
    });
    await o.executePlan(session, "task",
      [{ id: "s1", title: "Entwurf", description: "design it", workerId: "claude", dependsOn: [], editsFiles: false, roleId: "architekt" }],
      collector().io, { orchestra });
    const fix = state.turns.find((t) => isFix(t.prompt))!;
    expect(fix.row).toMatchObject({ permissionMode: "plan", allowedTools: "Read", approvalMode: "off" });
    expect(fix.prompt).toContain("Return the corrected, complete result.");
    expect(fix.prompt).toContain("with read-only access"); // like the subtask itself
  });

  it("Gemini runs them read-only even in a session where it could edit", async () => {
    const o = await loadOrchestrator(["claude", "gemini"]);
    const open = { ...session, permissionMode: "bypassPermissions", allowedTools: "Read,Edit,Bash,WebSearch" };
    const c = collector();
    await o.executePlan(open, "task", [
      { id: "s1", title: "Lesen", description: "look", workerId: "gemini", dependsOn: [], editsFiles: false },
      { id: "s2", title: "Ändern", description: "change", workerId: "gemini", dependsOn: [], editsFiles: true },
    ], c.io);
    const turn = (text: string) => state.turns.find((t) => t.prompt.startsWith(text))!;
    expect(turn("look").row).toMatchObject({
      provider: "gemini", permissionMode: "default", allowedTools: "Read,WebSearch", approvalMode: "off", sandbox: false,
    });
    expect(turn("change").row).toMatchObject({ provider: "gemini", permissionMode: "bypassPermissions", allowedTools: "Read,Edit,Bash,WebSearch" });
    expect(turn("look").prompt).toContain("with read-only access");
    expect(turn("change").prompt).not.toContain("read-only");
    // Gemini can edit here, so there is no read-only notice.
    expect(c.rows.filter((r) => r.role === "system")).toEqual([]);
  });

  it("a file-changing subtask on a worker the session restricts is told it runs read-only too", async () => {
    const o = await loadOrchestrator(["gemini"]); // no other editor to move it to
    await o.executePlan({ ...session, approvalMode: "edits" }, "task",
      [{ id: "s1", title: "Ändern", description: "change", workerId: "gemini", dependsOn: [], editsFiles: true }],
      collector().io);
    const turn = state.turns.find((t) => t.prompt.startsWith("change"))!;
    expect(turn.row).toMatchObject({ provider: "gemini", permissionMode: "default", allowedTools: "Read", approvalMode: "off" });
    expect(turn.prompt).toContain("with read-only access");
  });

  it("the planners are told that subtasks without file changes run read-only", async () => {
    const o = await loadOrchestrator(["claude"]);
    await o.planSubtasks(session, "t");
    await o.planSubtasks(session, "t", { orchestra: defaultOrchestraConfig() });
    const [workerPlanner, rolePlanner] = state.turns.filter((t) => isPlanner(t.prompt)).map((t) => t.prompt);
    expect(workerPlanner).toContain("A subtask with editsFiles false runs read-only");
    expect(rolePlanner).toContain("runs commands (tests, builds, git) to a role that changes files");
  });
});

// --- Planner limits ---------------------------------------------------------------

describe("planner limits", () => {
  it("keeps worker ids of long Ollama model names intact (the shared orchestra limit)", async () => {
    const o = await loadOrchestrator(["claude"]);
    const model = `hf.co/unsloth/${"q".repeat(186)}`; // Ollama ids go up to 200 characters
    const workerId = `ollama:${model}`;
    expect(workerId.length).toBeGreaterThan(120);
    expect(workerId.length).toBeLessThanOrEqual(ORCHESTRA_LIMITS.workerId);
    state.ollama = [{ id: model, name: model }];
    state.turnImpl = async (_row, prompt, emit) => {
      if (isPlanner(prompt)) {
        // One whole event, so only the id limit is under test here.
        emit({ type: "text", content: JSON.stringify({ subtasks: [
          { id: "s1", title: "Analyse", description: "analyse", workerId, dependsOn: [], editsFiles: false },
        ] }) });
      }
      return ok;
    };
    const logs: string[] = [];
    const res = await o.planSubtasks(session, "t", { onLog: (m) => logs.push(m) });
    expect(res.subtasks[0].workerId).toBe(workerId);
    expect(logs.some((m) => m.includes("nicht verfügbar"))).toBe(false);
    // The plan round-trips through the hybrid run schema.
    expect(orchestrateRunSchema.safeParse({ prompt: "t", subtasks: res.subtasks }).success).toBe(true);

    // And it runs on that model.
    const c = collector();
    await o.executePlan(session, "t", res.subtasks, c.io);
    expect(c.events.find((e) => e.type === "subtask_start")).toMatchObject({ workerId, workerLabel: `Local: ${model}` });
  });
});
