import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { orchestraConfigSchema, orchestrateRunSchema } from "@/lib/validation/schemas";
import {
  DEFAULT_ROLES,
  NO_LOCAL_AGENT_HINT,
  NO_MODEL_WARNING,
  autoConductor,
  buildPreset,
  defaultOrchestraConfig,
  parseVerdict,
  resolveRoleWorker,
  slugifyRoleId,
  validateOrchestra,
  type OrchestraConfig,
  type OrchestraWorkerInfo,
} from "./orchestra-types";
import type { OrchEvent } from "./orchestrator";

// --- Module-boundary mocks (prisma, model discovery, providers, CLI runner) ------

type TurnEmit = (e: { type: string; content?: string; isError?: boolean; costUsd?: number }) => void;
type TurnRow = { provider: string; permissionMode: string; allowedTools: string; approvalMode?: string };

const state = vi.hoisted(() => ({
  settings: new Map<string, string>(),
  ollama: [] as { id: string; name: string }[],
  turns: [] as { row: TurnRow; prompt: string }[],
  turnImpl: null as null | ((row: TurnRow, prompt: string, emit: TurnEmit, opts: { signal?: AbortSignal }) => Promise<unknown>),
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    assistantSession: { update: vi.fn(async () => ({})) },
    setting: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => {
        const value = state.settings.get(where.key);
        return value === undefined ? null : { key: where.key, value };
      }),
      upsert: vi.fn(async ({ where, update }: { where: { key: string }; update: { value: string } }) => {
        state.settings.set(where.key, update.value);
        return { key: where.key, value: update.value };
      }),
    },
  },
}));
vi.mock("@/lib/ai/ollama-provider", () => ({
  fetchOllamaModels: async () => state.ollama.map((m) => ({ ...m, provider: "ollama", maxTokens: 8192 })),
}));
vi.mock("@/lib/ai/openai-compatible-provider", () => ({ fetchOpenAICompatModels: async () => [] }));
vi.mock("@/lib/ai/provider-factory", () => ({
  createProvider: () => ({
    streamMessage: async function* () {
      yield { type: "text", content: "local text" };
      yield { type: "done", content: "" };
    },
  }),
}));
vi.mock("./runner", () => ({
  isMarker: () => false,
  runTurn: async (row: TurnRow, prompt: string, _key: unknown, emit: TurnEmit, opts: { signal?: AbortSignal }) => {
    state.turns.push({ row, prompt });
    return state.turnImpl!(row, prompt, emit, opts);
  },
}));
// pi is not installed here (pi workers: orchestrator-pi.test.ts).
vi.mock("./pi", () => ({
  piInfo: async () => ({ installed: false, version: null, bin: "pi" }),
  syncOllamaModels: async () => ({ models: [], syncedAt: null, ollamaBaseUrl: "", contextFallback: 32768 }),
}));

// --- Fixtures ---------------------------------------------------------------------

const CLAUDE: OrchestraWorkerInfo = { id: "claude", kind: "claude-cli", label: "Claude Code", editsFiles: true, local: false };
const GEMINI: OrchestraWorkerInfo = { id: "gemini", kind: "gemini-cli", label: "Gemini CLI", editsFiles: true, local: false };
const CODER: OrchestraWorkerInfo = { id: "ollama:qwen2.5-coder:7b", kind: "ollama", label: "Local: qwen2.5-coder:7b", editsFiles: false, local: true, model: "qwen2.5-coder:7b" };
const GEMMA: OrchestraWorkerInfo = { id: "ollama:gemma4:31b", kind: "ollama", label: "Local: gemma4:31b", editsFiles: false, local: true, model: "gemma4:31b" };
const LLAMA: OrchestraWorkerInfo = { id: "ollama:llama3.2:3b", kind: "ollama", label: "Local: llama3.2:3b", editsFiles: false, local: true, model: "llama3.2:3b" };
const GROQ: OrchestraWorkerInfo = { id: "api:groq", kind: "api", label: "API: Groq", editsFiles: false, local: false };
// A file-capable local agent (e.g. a future "pi" worker): picked by capability, not kind.
const PI: OrchestraWorkerInfo = { id: "pi:qwen3-coder:30b", kind: "pi", label: "pi: qwen3-coder:30b", editsFiles: true, local: true, model: "qwen3-coder:30b" };

const FULL = [CLAUDE, GEMINI, CODER, LLAMA, GEMMA, GROQ];
const OLLAMA_ONLY = [CODER, LLAMA, GEMMA];

const workerOf = (c: OrchestraConfig, id: string) => c.roles.find((r) => r.id === id)?.workerId;

function config(mutate: (c: OrchestraConfig) => void = () => {}): OrchestraConfig {
  const c = defaultOrchestraConfig();
  mutate(c);
  return c;
}

// --- Defaults & schema ------------------------------------------------------------

describe("defaults", () => {
  it("are valid against the schema and round-trip unchanged", () => {
    const d = defaultOrchestraConfig();
    expect(orchestraConfigSchema.parse(d)).toEqual(d);
    expect(d.roles.map((r) => r.id)).toEqual(["architekt", "coder", "reviewer", "tester", "recherche", "doku"]);
    expect(d.roles.filter((r) => r.editsFiles).map((r) => r.id)).toEqual(["coder", "tester", "doku"]);
    expect(d.roles.find((r) => r.id === "doku")!.enabled).toBe(false);
    expect(d.roles.find((r) => r.id === "coder")!.reviewLoop).toEqual({ enabled: true, reviewerRoleId: "reviewer", maxRounds: 2 });
    expect(d.roles.every((r) => r.workerId === "")).toBe(true);
    expect(d.roles.find((r) => r.id === "reviewer")!.instructions).toContain("<verdict>pass</verdict>");
  });

  it("produce no warnings with workers available and are fresh copies", () => {
    expect(validateOrchestra(defaultOrchestraConfig(), FULL)).toEqual([]);
    const a = defaultOrchestraConfig();
    a.roles[0].name = "X";
    a.roles[1].reviewLoop.maxRounds = 3;
    expect(DEFAULT_ROLES[0].name).toBe("Architekt");
    expect(defaultOrchestraConfig().roles[1].reviewLoop.maxRounds).toBe(2);
  });

  it("schema fills optional fields and rejects broken configs", () => {
    const parsed = orchestraConfigSchema.parse({ roles: [{ id: "qa", name: "QA" }] });
    expect(parsed).toEqual({
      version: 1,
      conductor: { workerId: "", instructions: "" },
      roles: [{
        id: "qa", name: "QA", description: "", instructions: "", workerId: "", editsFiles: false, enabled: true,
        reviewLoop: { enabled: false, reviewerRoleId: "", maxRounds: 1 },
      }],
      preset: "custom",
    });
    const dup = orchestraConfigSchema.safeParse({ roles: [{ id: "a", name: "A" }, { id: "a", name: "B" }] });
    expect(dup.success).toBe(false);
    expect(dup.error!.issues[0].message).toContain("mehrfach");
    expect(orchestraConfigSchema.safeParse({ roles: [{ id: "Bad Id", name: "A" }] }).success).toBe(false);
    expect(orchestraConfigSchema.safeParse({
      roles: [{ id: "a", name: "A", reviewLoop: { enabled: true, reviewerRoleId: "b", maxRounds: 4 } }],
    }).success).toBe(false);
    expect(orchestraConfigSchema.safeParse({ version: 2, roles: [] }).success).toBe(false);
  });

  it("planned subtasks accept an optional roleId", () => {
    const run = orchestrateRunSchema.parse({
      prompt: "p",
      subtasks: [{ id: "s1", workerId: "claude", roleId: "coder" }, { id: "s2", workerId: "claude" }],
    });
    expect(run.subtasks[0].roleId).toBe("coder");
    expect(run.subtasks[1].roleId).toBeUndefined();
  });

  it("slugifies role names into unique ids", () => {
    expect(slugifyRoleId("Übersetzer")).toBe("uebersetzer");
    expect(slugifyRoleId("Sicherheits-Prüfer!", ["sicherheits-pruefer"])).toBe("sicherheits-pruefer-2");
    expect(slugifyRoleId("???")).toBe("rolle");
  });
});

// --- Presets ----------------------------------------------------------------------

describe("presets", () => {
  it("quality puts the strongest model everywhere (claude + gemini + ollama)", () => {
    const { config: c, warnings } = buildPreset("quality", FULL);
    expect(orchestraConfigSchema.safeParse(c).success).toBe(true);
    expect(c.preset).toBe("quality");
    expect(c.conductor.workerId).toBe("claude");
    expect(c.roles.every((r) => r.workerId === "claude")).toBe(true);
    expect(warnings).toEqual([]);
  });

  it("balanced keeps claude for conductor/architect/reviewer and moves the rest to a cheaper file-capable worker", () => {
    const { config: c, warnings } = buildPreset("balanced", FULL);
    expect(orchestraConfigSchema.safeParse(c).success).toBe(true);
    expect(c.conductor.workerId).toBe("claude");
    expect(workerOf(c, "architekt")).toBe("claude");
    expect(workerOf(c, "reviewer")).toBe("claude");
    expect(workerOf(c, "coder")).toBe("gemini");
    expect(workerOf(c, "tester")).toBe("gemini");
    expect(workerOf(c, "recherche")).toBe("gemini");
    expect(warnings).toEqual([]);
    // Without Gemini, a local file-capable agent is the cheaper option.
    const withPi = buildPreset("balanced", [CLAUDE, PI, GEMMA]).config;
    expect(workerOf(withPi, "coder")).toBe(PI.id);
    expect(workerOf(withPi, "reviewer")).toBe("claude");
    // Only Claude can touch files: it does everything.
    expect(workerOf(buildPreset("balanced", [CLAUDE, GEMMA]).config, "coder")).toBe("claude");
    // Any role that reviews another one keeps the strongest model.
    const custom = config((x) => {
      x.roles.push({ ...x.roles[2], id: "sicherheit", name: "Sicherheit" });
      x.roles.find((r) => r.id === "tester")!.reviewLoop = { enabled: true, reviewerRoleId: "sicherheit", maxRounds: 1 };
    });
    expect(workerOf(buildPreset("balanced", FULL, custom).config, "sicherheit")).toBe("claude");
  });

  it("local uses local models only and warns where nothing local can edit files", () => {
    const { config: c, warnings } = buildPreset("local", FULL);
    expect(orchestraConfigSchema.safeParse(c).success).toBe(true);
    expect(c.conductor.workerId).toBe(GEMMA.id);
    expect(workerOf(c, "architekt")).toBe(GEMMA.id);
    expect(workerOf(c, "reviewer")).toBe(GEMMA.id);
    expect(workerOf(c, "recherche")).toBe(GEMMA.id);
    expect(workerOf(c, "coder")).toBe("");
    expect(workerOf(c, "tester")).toBe("");
    expect(warnings).toEqual([
      "Kein lokales Modell mit Dateizugriff für Rolle „Coder“ verfügbar — Zuweisung auf Automatisch gesetzt.",
      "Kein lokales Modell mit Dateizugriff für Rolle „Tester“ verfügbar — Zuweisung auf Automatisch gesetzt.",
      // Points at pi, which turns the local models into file-editing agents.
      NO_LOCAL_AGENT_HINT,
    ]);
    // A file-capable local worker takes the editing roles; text roles stay on the text model.
    const withPi = buildPreset("local", [...FULL, PI]);
    expect(workerOf(withPi.config, "coder")).toBe(PI.id);
    expect(workerOf(withPi.config, "tester")).toBe(PI.id);
    expect(workerOf(withPi.config, "architekt")).toBe(GEMMA.id);
    expect(withPi.warnings).toEqual([]);
  });

  it("ollama only: text roles on the strongest general model, editing roles on Auto with warnings", () => {
    for (const preset of ["quality", "balanced", "local"] as const) {
      const { config: c, warnings } = buildPreset(preset, OLLAMA_ONLY);
      expect(orchestraConfigSchema.safeParse(c).success).toBe(true);
      expect(c.conductor.workerId).toBe(GEMMA.id);
      expect(workerOf(c, "architekt")).toBe(GEMMA.id);
      expect(workerOf(c, "coder")).toBe("");
      expect(warnings.some((w) => w.includes("„Coder“") && w.includes("Dateizugriff"))).toBe(true);
      // Auto falls back to a text model: the validator says so.
      expect(warnings).toContain(
        "Kein Modell mit Dateizugriff verfügbar für Rolle „Coder“ — Local: gemma4:31b liefert nur Text, Dateien bleiben unverändert."
      );
    }
  });

  it("no workers: everything on Auto with one warning", () => {
    for (const preset of ["quality", "balanced", "local"] as const) {
      const { config: c, warnings } = buildPreset(preset, []);
      expect(orchestraConfigSchema.safeParse(c).success).toBe(true);
      expect(c.conductor.workerId).toBe("");
      expect(c.roles.every((r) => r.workerId === "")).toBe(true);
      expect(warnings).toEqual([NO_MODEL_WARNING]);
    }
  });

  it("keeps the user's roles when a base config is given", () => {
    const base = config((c) => {
      c.roles[1].instructions = "Use tabs.";
      c.roles.push({ ...c.roles[4], id: "uebersetzer", name: "Übersetzer", workerId: "ollama:gone" });
      c.conductor.instructions = "Antworte auf Deutsch.";
    });
    const { config: c } = buildPreset("quality", FULL, base);
    expect(c.roles.find((r) => r.id === "coder")!.instructions).toBe("Use tabs.");
    expect(workerOf(c, "uebersetzer")).toBe("claude");
    expect(c.conductor).toEqual({ workerId: "claude", instructions: "Antworte auf Deutsch." });
    expect(base.roles[1].workerId).toBe(""); // input not mutated
  });
});

// --- Validation & resolution ------------------------------------------------------

describe("validateOrchestra", () => {
  it("reports unavailable models, text workers on editing roles and broken review loops", () => {
    const c = config((x) => {
      x.conductor.workerId = "api:openai";
      x.roles.find((r) => r.id === "coder")!.workerId = CODER.id;
      x.roles.find((r) => r.id === "architekt")!.workerId = "ollama:gone";
      x.roles.find((r) => r.id === "tester")!.reviewLoop = { enabled: true, reviewerRoleId: "tester", maxRounds: 1 };
      x.roles.find((r) => r.id === "recherche")!.reviewLoop = { enabled: true, reviewerRoleId: "nobody", maxRounds: 1 };
    });
    expect(validateOrchestra(c, FULL)).toEqual([
      "„Tester“ kann sich nicht selbst prüfen — wähle eine andere Rolle für die Prüfschleife.",
      "Die Prüfschleife von „Recherche“ zeigt auf eine Rolle, die es nicht gibt („nobody“).",
      "Dirigent: Modell „api:openai“ ist nicht verfügbar — stattdessen wird automatisch gewählt.",
      "Rolle „Architekt“: Modell „ollama:gone“ ist nicht verfügbar — stattdessen wird automatisch gewählt.",
      "Rolle „Coder“ soll Dateien ändern, aber Local: qwen2.5-coder:7b kann keine Dateien bearbeiten — beim Start übernimmt ein Modell mit Dateizugriff, falls eines verfügbar ist.",
    ]);
  });

  it("reports a disabled reviewer, duplicate ids, no active roles and no models", () => {
    const disabledReviewer = config((x) => { x.roles.find((r) => r.id === "reviewer")!.enabled = false; });
    expect(validateOrchestra(disabledReviewer, FULL)).toEqual([
      "Die prüfende Rolle „Reviewer“ für „Coder“ ist deaktiviert — die Prüfschleife wird übersprungen.",
    ]);
    const dup = config((x) => { x.roles[1].id = "architekt"; });
    expect(validateOrchestra(dup, FULL)[0]).toContain("„architekt“ kommt mehrfach vor");
    const none = config((x) => x.roles.forEach((r) => { r.enabled = false; }));
    expect(validateOrchestra(none, FULL)).toEqual([
      "Keine Rolle aktiv — der Dirigent verteilt die Teilaufgaben direkt an die Modelle.",
    ]);
    expect(validateOrchestra(defaultOrchestraConfig(), [])).toEqual([NO_MODEL_WARNING]);
  });
});

describe("role → worker resolution", () => {
  const coder = { workerId: "", editsFiles: true };
  const text = { workerId: "", editsFiles: false };

  it("uses the configured worker when available, else Auto", () => {
    expect(resolveRoleWorker({ workerId: "gemini", editsFiles: true }, FULL)).toEqual({ worker: GEMINI, auto: false, unavailable: false });
    expect(resolveRoleWorker({ workerId: "api:gone", editsFiles: true }, FULL)).toEqual({ worker: CLAUDE, auto: true, unavailable: true });
    expect(resolveRoleWorker({ workerId: " auto ", editsFiles: true }, FULL)).toEqual({ worker: CLAUDE, auto: true, unavailable: false });
  });

  it("Auto: strongest file-capable worker for editing roles, the conductor for text roles", () => {
    expect(resolveRoleWorker(coder, FULL).worker).toBe(CLAUDE);
    expect(resolveRoleWorker(coder, [GEMINI, PI, GEMMA]).worker).toBe(GEMINI);
    expect(resolveRoleWorker(coder, [PI, GEMMA]).worker).toBe(PI);
    // Session-aware capability (e.g. a gated Gemini is read-only).
    expect(resolveRoleWorker(coder, [GEMINI, PI], { canEdit: (w) => w.kind !== "gemini-cli" }).worker).toBe(PI);
    // Nothing can edit files: the conductor's model delivers text.
    expect(resolveRoleWorker(coder, OLLAMA_ONLY).worker).toBe(GEMMA);
    expect(resolveRoleWorker(text, FULL).worker).toBe(CLAUDE);
    expect(resolveRoleWorker(text, FULL, { conductor: GROQ }).worker).toBe(GROQ);
    expect(resolveRoleWorker(text, [])).toEqual({ worker: null, auto: true, unavailable: false });
  });

  it("auto conductor: Claude > Gemini > strongest general local > cloud API", () => {
    expect(autoConductor(FULL)).toBe(CLAUDE);
    expect(autoConductor([GROQ, GEMINI, GEMMA])).toBe(GEMINI);
    expect(autoConductor([GROQ, CODER, LLAMA, GEMMA])).toBe(GEMMA);
    expect(autoConductor([CODER, GROQ])).toBe(GROQ);
    expect(autoConductor([])).toBeUndefined();
  });
});

describe("parseVerdict", () => {
  it("reads the last verdict tag", () => {
    expect(parseVerdict("All good.\n<verdict>pass</verdict>")).toBe("pass");
    expect(parseVerdict("1. src/a.ts:12 off by one\n<verdict> CHANGES </verdict>\n")).toBe("changes");
    expect(parseVerdict("Use <verdict>pass</verdict> or <verdict>changes</verdict>… final: <verdict>pass</verdict>")).toBe("pass");
    expect(parseVerdict("Looks fine to me.")).toBe("unknown");
    expect(parseVerdict("<verdict>maybe</verdict>")).toBe("unknown");
  });
});

// --- Persistence ------------------------------------------------------------------

describe("orchestra persistence", () => {
  beforeEach(() => state.settings.clear());

  it("loads defaults, saves normalized configs and survives broken rows", async () => {
    const { loadOrchestraConfig, saveOrchestraConfig, ORCHESTRA_SETTING_KEY } = await import("./orchestra");
    expect(await loadOrchestraConfig()).toEqual(defaultOrchestraConfig());
    const custom = config((c) => { c.roles = c.roles.slice(0, 2); c.preset = "custom"; });
    const saved = await saveOrchestraConfig(custom);
    expect(saved).toEqual(custom);
    expect(JSON.parse(state.settings.get(ORCHESTRA_SETTING_KEY)!)).toEqual(custom);
    expect(await loadOrchestraConfig()).toEqual(custom);
    state.settings.set(ORCHESTRA_SETTING_KEY, "{not json");
    expect(await loadOrchestraConfig()).toEqual(defaultOrchestraConfig());
    state.settings.set(ORCHESTRA_SETTING_KEY, JSON.stringify({ version: 1, roles: [{ id: "BAD" }] }));
    expect(await loadOrchestraConfig()).toEqual(defaultOrchestraConfig());
  });
});

// --- Orchestrator: role planning and review loop ----------------------------------

const session = {
  id: "s1", externalId: null, provider: "claude", model: "", cwd: "/tmp/proj",
  permissionMode: "acceptEdits", allowedTools: "Read,Edit,Bash", approvalMode: "off", sandbox: false,
};

function fakeBinDir(bins: string[]): string {
  const d = mkdtempSync(path.join(tmpdir(), "orch-bins-"));
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

const isPlanner = (p: string) => p.includes("orchestration planner");
const isReview = (p: string) => p.includes("Review round");
const isFix = (p: string) => p.includes("reviewed your work");
const isSynthesis = (p: string) => p.startsWith("You orchestrated");

describe("orchestrator with roles", () => {
  beforeEach(() => {
    state.turns = [];
    state.ollama = [];
    state.turnImpl = async (_row, _prompt, emit) => {
      emit({ type: "text", content: "done" });
      return { externalId: null, costUsd: 0.1, isError: false };
    };
  });
  afterAll(() => { process.env.PATH = ORIGINAL_PATH; });

  it("plans by role: the prompt lists enabled roles, subtasks get roleId and a role-derived worker", async () => {
    const o = await loadOrchestrator(["claude", "gemini"]);
    state.turnImpl = async (_row, prompt, emit) => {
      if (isPlanner(prompt)) {
        emit({ type: "text", content: JSON.stringify({ subtasks: [
          { id: "s1", title: "Entwurf", roleId: "architekt", description: "design", dependsOn: [] },
          { id: "s2", title: "Umsetzen", roleId: "coder", description: "build", dependsOn: ["s1"] },
          { id: "s3", title: "Doku", roleId: "doku", description: "docs", dependsOn: ["s2"] },
          { id: "s4", title: "Frei", roleId: "nobody", description: "x", editsFiles: true },
          // The display name instead of the id still binds the role.
          { id: "s5", title: "Prüfen", roleId: "Tester", description: "test", dependsOn: ["s2"] },
        ] }) });
      }
      return { externalId: null, costUsd: 0.01, isError: false };
    };
    const orchestra = config((c) => {
      c.roles.find((r) => r.id === "coder")!.workerId = "gemini";
      c.roles.find((r) => r.id === "recherche")!.workerId = "api:gone";
      c.conductor.instructions = "Plane knapp.";
    });
    const logs: string[] = [];
    const res = await o.planSubtasks(session, "Baue Feature X", { orchestra, onLog: (m) => logs.push(m) });

    const prompt = state.turns.find((t) => isPlanner(t.prompt))!.prompt;
    expect(prompt).toContain("- coder — Coder (changes files; reviewed automatically by Reviewer):");
    expect(prompt).toContain("- architekt — Architekt (does not change files):");
    expect(prompt).not.toContain("- doku");
    expect(prompt).not.toContain("Available workers");
    expect(prompt).toContain("Additional instructions from the user for you as the conductor:\nPlane knapp.");
    expect(prompt).toContain('"roleId"');

    expect(res.subtasks.map((s) => [s.id, s.roleId, s.workerId, s.editsFiles])).toEqual([
      ["s1", "architekt", "claude", false],
      ["s2", "coder", "gemini", true],
      ["s3", undefined, "claude", false],
      ["s4", undefined, "claude", true],
      ["s5", "tester", "claude", true],
    ]);
    expect(logs).toContain("Planer (Auto): Claude Code");
    expect(logs).toContain("Rolle „doku“ ist unbekannt oder deaktiviert — „Doku“ läuft ohne Rolle.");
    // The edited plan round-trips through the hybrid run schema.
    expect(orchestrateRunSchema.safeParse({ prompt: "p", subtasks: res.subtasks }).success).toBe(true);
  });

  it("conductor.workerId plans unless an explicit plannerWorkerId overrides it", async () => {
    const o = await loadOrchestrator(["claude", "gemini"]);
    const orchestra = config((c) => { c.conductor.workerId = "gemini"; });
    await o.planSubtasks(session, "t", { orchestra });
    expect(state.turns.find((t) => isPlanner(t.prompt))!.row.provider).toBe("gemini");
    state.turns = [];
    await o.planSubtasks(session, "t", { orchestra, plannerWorkerId: "claude" });
    expect(state.turns.find((t) => isPlanner(t.prompt))!.row.provider).toBe("claude");
  });

  it("without an orchestra or without enabled roles the worker-based planner is used (old behaviour)", async () => {
    const o = await loadOrchestrator(["claude"]);
    const fallback = [{ id: "s1", title: "Aufgabe bearbeiten", description: "t", workerId: "claude", dependsOn: [], editsFiles: true }];
    for (const orchestra of [undefined, null, config((c) => c.roles.forEach((r) => { r.enabled = false; }))]) {
      state.turns = [];
      const res = await o.planSubtasks(session, "t", { orchestra });
      const prompt = state.turns.find((t) => isPlanner(t.prompt))!.prompt;
      expect(prompt).toContain("Available workers:");
      expect(prompt).not.toMatch(/\b(NOT|ONLY|ENTIRE|MUST|EXACTLY|MINIMUM)\b/); // no shouting
      // Narrated planner output → single-subtask fallback on the file editor, no role.
      expect(res.subtasks).toEqual(fallback);
    }
  });

  it("the narrated-plan fallback runs without a role on the first editing role's worker", async () => {
    const o = await loadOrchestrator(["claude", "gemini"]);
    const res = await o.planSubtasks(session, "t", { orchestra: defaultOrchestraConfig() });
    expect(res.subtasks).toEqual([{ id: "s1", title: "Aufgabe bearbeiten", description: "t", workerId: "claude", dependsOn: [], editsFiles: true }]);
    const pinned = config((c) => { c.roles.find((r) => r.id === "coder")!.workerId = "gemini"; });
    const res2 = await o.planSubtasks(session, "t", { orchestra: pinned });
    expect(res2.subtasks).toEqual([{ id: "s1", title: "Aufgabe bearbeiten", description: "t", workerId: "gemini", dependsOn: [], editsFiles: true }]);
  });

  it("without an orchestra a plan runs as before: no role framing, no reviews, no roles on the plan event", async () => {
    const o = await loadOrchestrator(["claude"]);
    const c = collector();
    await o.executePlan(session, "task",
      [{ id: "s1", title: "A", description: "a", workerId: "claude", dependsOn: [], editsFiles: true, roleId: "coder" }],
      c.io);
    const work = state.turns.find((t) => !isSynthesis(t.prompt))!;
    expect(work.prompt.startsWith("a")).toBe(true);
    expect(c.events.some((e) => e.type.startsWith("review_"))).toBe(false);
    expect(c.events.find((e) => e.type === "plan")!.roles).toBeUndefined();
    // The unknown role is dropped from the plan (with a note), so no event names it.
    expect(c.events.find((e) => e.type === "plan")!.subtasks![0].roleId).toBeUndefined();
    expect(c.rows.some((r) => r.role === "system" && r.content === "Rolle „coder“ gibt es nicht (mehr) — „A“ läuft ohne Rolle.")).toBe(true);
    expect(c.events.find((e) => e.type === "subtask_start")!.roleId).toBeUndefined();
  });

  it("hands every earlier subtask to the next agent — also without dependsOn — and asks for a handoff section", async () => {
    const o = await loadOrchestrator(["claude"]);
    state.turnImpl = async (_row, prompt, emit) => {
      if (prompt.startsWith("first")) emit({ type: "text", content: "explored a lot\n## Handoff\n- API lives in src/api.ts" });
      else if (prompt.startsWith("second")) emit({ type: "text", content: "second done" });
      else emit({ type: "text", content: "ok" });
      return { externalId: null, costUsd: 0, isError: false };
    };
    const c = collector();
    await o.executePlan(session, "task", [
      { id: "s1", title: "Eins", description: "first", workerId: "claude", dependsOn: [], editsFiles: false },
      { id: "s2", title: "Zwei", description: "second", workerId: "claude", dependsOn: [], editsFiles: false },
      { id: "s3", title: "Drei", description: "third", workerId: "claude", dependsOn: ["s2"], editsFiles: false },
    ], c.io);
    const promptOf = (start: string) => state.turns.find((t) => t.prompt.startsWith(start))!.prompt;

    // The first agent has nothing to build on, but is asked to leave a handoff.
    expect(promptOf("first")).not.toContain("<previous_work>");
    expect(promptOf("first")).toContain('headed exactly "## Handoff"');

    // The second gets the first one's handoff section although it declares no dependency.
    const second = promptOf("second");
    expect(second).toContain('<subtask id="s1" title="Eins" by="Claude Code">');
    expect(second).toContain("- API lives in src/api.ts");
    expect(second).not.toContain("explored a lot");

    // The third sees both, its dependency marked; as the last one it reports to the summary.
    const third = promptOf("third");
    expect(third).toContain('<subtask id="s1"');
    expect(third).toContain('<subtask id="s2" title="Zwei" by="Claude Code" status="you build on this">');
    expect(third).toContain("second done");
    expect(third).not.toContain('headed exactly "## Handoff"');

    // The summary is built from the handoff section too.
    const synth = state.turns.find((t) => isSynthesis(t.prompt))!.prompt;
    expect(synth).toContain("- API lives in src/api.ts");
    expect(synth).not.toContain("explored a lot");
  });

  it("gives every worker the team sync, and the session recap only to workers without the session's conversation", async () => {
    const o = await loadOrchestrator(["claude"]);
    const st = [{ id: "s1", title: "A", description: "work", workerId: "claude", dependsOn: [], editsFiles: false }];
    const opts = { teamSync: "<team_sync>pi changed src/a.ts</team_sync>", sessionRecap: "<session_recap>earlier here</session_recap>" };
    const promptFor = async (s: Omit<typeof session, "externalId"> & { externalId: string | null }) => {
      state.turns = [];
      const res = await o.executePlan(s, "task", st, collector().io, opts);
      expect(res).toMatchObject({ stopped: false, agents: ["Claude Code"], files: [] });
      expect(typeof res.summary).toBe("string");
      return state.turns.find((t) => t.prompt.startsWith("work"))!.prompt;
    };
    // No conversation to continue: the worker needs the recap too.
    const fresh = await promptFor({ ...session, externalId: null });
    expect(fresh).toContain("<team_sync>pi changed src/a.ts</team_sync>");
    expect(fresh).toContain("<session_recap>earlier here</session_recap>");
    // A Claude Code worker forks the Claude Code session's conversation: it already knows.
    const forked = await promptFor({ ...session, provider: "claude", externalId: "conv-1" });
    expect(forked).toContain("<team_sync>pi changed src/a.ts</team_sync>");
    expect(forked).not.toContain("<session_recap>");
  });

  it("runs the review loop: changes → fix round → pass, with role framing, events, rows and costs", async () => {
    const o = await loadOrchestrator(["claude"]);
    let reviews = 0;
    state.turnImpl = async (_row, prompt, emit) => {
      if (isReview(prompt)) {
        reviews++;
        emit({ type: "text", content: reviews === 1 ? "src/a.ts:3 misses null check\n<verdict>changes</verdict>" : "<verdict>pass</verdict>" });
        return { externalId: null, costUsd: 0.02, isError: false };
      }
      if (isFix(prompt)) emit({ type: "text", content: "added null check" });
      else if (isSynthesis(prompt)) emit({ type: "text", content: "summary" });
      else emit({ type: "text", content: "implemented" });
      return { externalId: null, costUsd: 0.1, isError: false };
    };
    const c = collector();
    const res = await o.executePlan(session, "task",
      [{ id: "s1", title: "Umsetzen", description: "build it", workerId: "claude", dependsOn: [], editsFiles: true, roleId: "coder" }],
      c.io, { orchestra: defaultOrchestraConfig() });

    expect(res).toMatchObject({ costUsd: expect.closeTo(0.1 + 0.02 + 0.1 + 0.02 + 0.1, 5), isError: false, stopped: false });
    const work = state.turns.find((t) => t.prompt.includes("build it") && !isReview(t.prompt) && !isFix(t.prompt))!;
    expect(work.prompt.startsWith("You are the Coder on this team. Implement the subtask")).toBe(true);
    expect(work.prompt).toContain("Your subtask:\nbuild it");
    const review = state.turns.find((t) => isReview(t.prompt))!;
    expect(review.row.permissionMode).toBe("plan"); // read-only, tool-less text run
    expect(review.prompt).toContain("You are the Reviewer on this team.");
    expect(review.prompt).toContain("Read the affected files");
    expect(review.prompt).toContain("Report from the Coder:\n<report>\nimplemented\n</report>");
    const fix = state.turns.find((t) => isFix(t.prompt))!;
    expect(fix.row.permissionMode).toBe("acceptEdits"); // real work with the session's mode
    expect(fix.prompt).toContain("src/a.ts:3 misses null check");

    const seq = c.events
      .filter((e) => e.type.startsWith("subtask_") || e.type.startsWith("review_"))
      .map((e) => `${e.type}${e.round ? `#${e.round}` : ""}${e.fixRound ? `(fix${e.fixRound})` : ""}${e.verdict ? `:${e.verdict}` : ""}`);
    expect(seq).toEqual([
      "subtask_start", "subtask_text",
      "review_start#1", "review_text#1", "review_end#1:changes",
      "subtask_text(fix1)",
      "review_start#2", "review_text#2", "review_end#2:pass",
      "subtask_end",
    ]);
    expect(c.events.find((e) => e.type === "subtask_start")).toMatchObject({ roleId: "coder", roleName: "Coder", workerId: "claude" });
    expect(c.events.find((e) => e.type === "subtask_end")).toMatchObject({ roleId: "coder", roleName: "Coder" });
    expect(c.events.find((e) => e.type === "review_start")).toMatchObject({ reviewerRoleId: "reviewer", reviewerLabel: "Claude Code", subtaskId: "s1" });
    expect(c.events.find((e) => e.type === "plan")!.roles).toEqual([{ id: "coder", name: "Coder", editsFiles: true }]);

    expect(c.rows.map((r) => r.role)).toEqual(["plan", "assistant", "assistant", "assistant", "assistant", "synthesis"]);
    const metas = c.rows.map((r) => (r.meta ? JSON.parse(r.meta) : {}));
    expect(metas[1]).toMatchObject({ subtaskId: "s1", roleId: "coder", roleName: "Coder" });
    expect(metas[2]).toMatchObject({ subtaskId: "s1", review: true, round: 1, verdict: "changes", worker: "Claude Code", roleName: "Reviewer" });
    expect(metas[3]).toMatchObject({ subtaskId: "s1", fixRound: 1, roleId: "coder" });
    expect(metas[4]).toMatchObject({ review: true, round: 2, verdict: "pass" });
    const synth = state.turns.find((t) => isSynthesis(t.prompt))!;
    expect(synth.prompt).toContain("Review by Reviewer: pass after 2 round(s)");
    expect(synth.prompt).toContain("added null check");
  });

  it("stops after maxRounds with open findings and notes it", async () => {
    const o = await loadOrchestrator(["claude"]);
    state.turnImpl = async (_row, prompt, emit) => {
      emit({ type: "text", content: isReview(prompt) ? "still broken\n<verdict>changes</verdict>" : "work" });
      return { externalId: null, costUsd: 0, isError: false };
    };
    const orchestra = config((c) => { c.roles.find((r) => r.id === "coder")!.reviewLoop.maxRounds = 3; });
    const c = collector();
    await o.executePlan(session, "task",
      [{ id: "s1", title: "Umsetzen", description: "b", workerId: "claude", dependsOn: [], editsFiles: true, roleId: "coder" }],
      c.io, { orchestra });
    expect(state.turns.filter((t) => isReview(t.prompt)).length).toBe(3);
    expect(state.turns.filter((t) => isFix(t.prompt)).length).toBe(2);
    expect(c.rows.some((r) => r.role === "system" && r.content === "Prüfschleife: „Umsetzen“ hat nach 3 Runden noch offene Punkte.")).toBe(true);
  });

  it("Stop during a review: no fix round, no synthesis", async () => {
    const o = await loadOrchestrator(["claude"]);
    const ac = new AbortController();
    state.turnImpl = async (_row, prompt, emit) => {
      if (isReview(prompt)) {
        emit({ type: "text", content: "partial" });
        ac.abort();
        return { externalId: null, costUsd: 0.01, isError: true };
      }
      emit({ type: "text", content: "work" });
      return { externalId: null, costUsd: 0, isError: false };
    };
    const c = collector();
    const res = await o.executePlan(session, "task", [
      { id: "s1", title: "A", description: "a", workerId: "claude", dependsOn: [], editsFiles: true, roleId: "coder" },
      { id: "s2", title: "B", description: "b", workerId: "claude", dependsOn: [], editsFiles: true, roleId: "coder" },
    ], { ...c.io, signal: ac.signal }, { orchestra: defaultOrchestraConfig() });
    expect(res.stopped).toBe(true);
    expect(state.turns.some((t) => isFix(t.prompt))).toBe(false);
    expect(state.turns.some((t) => isSynthesis(t.prompt))).toBe(false);
    expect(c.events.filter((e) => e.type === "subtask_start").length).toBe(1);
    expect(c.events.some((e) => e.type === "error")).toBe(false);
    expect(c.events.find((e) => e.type === "review_end")).toMatchObject({ verdict: "unknown" });
  });

  it("skips the review when the reviewer role is disabled; a text reviewer judges the report only", async () => {
    const o = await loadOrchestrator(["claude"]);
    const st = [{ id: "s1", title: "A", description: "a", workerId: "claude", dependsOn: [], editsFiles: true, roleId: "coder" }];
    const off = config((c) => { c.roles.find((r) => r.id === "reviewer")!.enabled = false; });
    const c1 = collector();
    await o.executePlan(session, "task", st, c1.io, { orchestra: off });
    expect(c1.events.some((e) => e.type.startsWith("review_"))).toBe(false);

    state.turns = [];
    state.ollama = [{ id: "gemma4:31b", name: "gemma4:31b (31B)" }];
    const o2 = await loadOrchestrator(["claude"]);
    const local = config((c) => { c.roles.find((r) => r.id === "reviewer")!.workerId = "ollama:gemma4:31b"; });
    const c2 = collector();
    await o2.executePlan(session, "task", st, c2.io, { orchestra: local });
    expect(c2.events.find((e) => e.type === "review_start")).toMatchObject({ reviewerLabel: "Local: gemma4:31b" });
    expect(c2.events.filter((e) => e.type === "review_text").map((e) => e.content).join("")).toBe("local text");
    expect(c2.events.find((e) => e.type === "review_end")).toMatchObject({ verdict: "unknown" });
    // No verdict tag: no fix round, and the user is told why.
    expect(c2.rows.some((r) => r.role === "system" && r.content.includes("ohne eindeutiges Urteil"))).toBe(true);
    expect(state.turns.some((t) => isFix(t.prompt))).toBe(false);
  });
});
