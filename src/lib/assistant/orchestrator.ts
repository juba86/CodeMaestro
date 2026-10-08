import { promises as fs, constants as fsConstants } from "fs";
import path from "path";
import os from "node:os";
import { prisma } from "@/lib/db/client";
import { runTurn, type AssistantSessionRow } from "./runner";
import { piInfo, syncOllamaModels, type PiModel } from "./pi";
import type { HubEvent } from "./run-hub";
import type { RunContext, RunOutcome } from "./session-run";
import type { TranscriptRow } from "./transcript";
import { fetchOllamaModels } from "@/lib/ai/ollama-provider";
import { createProvider } from "@/lib/ai/provider-factory";
import { getProvider } from "@/lib/ai/catalog";
import { fetchOpenAICompatModels } from "@/lib/ai/openai-compatible-provider";
import type { AIProvider, ModelInfo } from "@/lib/ai/types";
import {
  CODER_MODEL,
  ORCHESTRA_LIMITS,
  bestFileWorker,
  clampRounds,
  isLocalWorker,
  paramBillions,
  parseVerdict,
  resolveConductor,
  resolveRoleWorker,
  reviewerFor,
  strongestGeneral,
  strongestWorker,
  type OrchestraConfig,
  type OrchestraRole,
  type OrchestraWorkerInfo,
  type ReviewVerdict,
} from "./orchestra-types";

// A configured OpenAI-compatible provider passed from the client (key/base URL
// live in the browser). Offered to the planner as an optional text worker.
export interface ClientProvider {
  id: string;
  key?: string;
  baseUrl?: string;
}

// A worker is a concrete model the orchestrator can route a subtask to.
// "pi" = a local Ollama model as a file-editing agent via the pi coding agent.
export interface Worker {
  id: string;
  kind: "claude-cli" | "gemini-cli" | "pi" | "ollama" | "api";
  model: string;
  label: string;
  strengths: string;
  editsFiles: boolean;
  /** Runs on this machine / the local network (see orchestra-types isLocalWorker). */
  local?: boolean;
  providerId?: string; // for kind "api" — catalog id
  apiKey?: string; // for kind "api"
  baseUrl?: string; // for kind "api" (custom endpoint)
}

/** A worker's client-visible capabilities (never the API key or base URL). */
export function toWorkerInfo(w: Worker): OrchestraWorkerInfo {
  return { id: w.id, kind: w.kind, label: w.label, editsFiles: w.editsFiles, local: isLocalWorker(w), model: w.model, strengths: w.strengths };
}

// Published into the session's run as-is (see run-hub). `synthesis`,
// `subtask_text` and `review_text` carry incremental chunks — clients append.
// A review round is `review_start` → `review_text`* → `review_end`; when the
// verdict is "changes", the author's fix round streams as `subtask_text` with
// `fixRound` set.
export interface OrchEvent {
  type:
    | "plan" | "subtask_start" | "subtask_text" | "subtask_end"
    | "review_start" | "review_text" | "review_end"
    | "synthesis" | "error" | "log";
  content?: string;
  subtaskId?: string;
  title?: string;
  workerId?: string;
  workerLabel?: string;
  subtasks?: PlannedSubtask[];
  /** On `plan`: the orchestra roles the subtasks may reference. */
  roles?: { id: string; name: string; editsFiles: boolean }[];
  /** The orchestra role running the subtask (subtask_start/subtask_end). */
  roleId?: string;
  roleName?: string;
  /** Review round (1-based) on review_* events. */
  round?: number;
  /** On subtask_text: the author's output in the fix round after review round N. */
  fixRound?: number;
  reviewerRoleId?: string;
  /** review_start: the review loop's round cap (for "Runde n/m"). */
  maxRounds?: number;
  reviewerRoleName?: string;
  reviewerLabel?: string;
  verdict?: ReviewVerdict;
  /** On `log`: a user-facing note that is also persisted as a "system" row. */
  notice?: boolean;
}

export interface PlannedSubtask {
  id: string;
  title: string;
  description: string;
  workerId: string;
  dependsOn: string[];
  editsFiles: boolean;
  /** The orchestra role running this subtask (absent in role-less plans). */
  roleId?: string;
}

export interface OrchestrationOptions {
  preference?: string;
  clientProviders?: ClientProvider[];
  /** "" / "auto" = the conductor from `orchestra` (or Auto); otherwise a worker id that plans and synthesizes. */
  plannerWorkerId?: string;
  /** Roles, their models and review loops. Without enabled roles the planner routes to workers directly. */
  orchestra?: OrchestraConfig | null;
}

/** Where an orchestration reports to: live events, ordered transcript rows, Stop. */
export interface OrchestrationIO {
  emit: (e: OrchEvent) => void;
  /** Persists a transcript row; called in stream order. */
  record?: (row: TranscriptRow) => void;
  signal?: AbortSignal;
}

export interface OrchestrationResult {
  costUsd: number;
  isError: boolean;
  stopped: boolean;
}

const NO_WORKER_MSG =
  "Kein Worker verfügbar: weder Claude Code noch Gemini CLI gefunden, keine lokalen Ollama-Modelle und keine Cloud-API konfiguriert.";
const STOPPED_MSG = "Gestoppt — keine weiteren Teilaufgaben, keine Zusammenfassung.";

// --- Local capability discovery (memoized) -------------------------------------

/** True when an executable `bin` is on the server's PATH — exactly what spawn() resolves. */
async function onPath(bin: string): Promise<boolean> {
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const exts = process.platform === "win32"
    ? ["", ...(process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";").filter(Boolean)]
    : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      try {
        await fs.access(path.join(dir, bin + ext), fsConstants.X_OK);
        return true;
      } catch { /* keep looking */ }
    }
  }
  return false;
}

async function geminiAvailable(): Promise<boolean> {
  if (!(await onPath("gemini"))) return false;
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) return true;
  try {
    await fs.access(path.join(os.homedir(), ".gemini", "oauth_creds.json"));
    return true;
  } catch {
    return false;
  }
}

interface LocalPool {
  claude: boolean;
  gemini: boolean;
  ollama: ModelInfo[];
  /** Ollama models pi can run as file-editing agents (pi installed, tool calling). */
  pi: PiModel[];
}

// Discovery (PATH probes, gemini creds, Ollama /api/tags, pi + its model sync)
// is shared by the workers dropdown, planning and execution — memoize it
// briefly so one orchestration doesn't repeat it. Client providers are cheap
// (no I/O) and are rebuilt on every call, so keys/base URLs are never stale.
// Kept on globalThis so every route's module graph shares one cache per process.
const POOL_TTL_MS = 30_000;
const API_MODEL_TTL_MS = 5 * 60_000;
// An unreachable Ollama host (e.g. an offline tailnet machine) or a hanging
// `pi --version` must not stall discovery — and with it a run that Stop
// cannot interrupt yet. A pi sync that runs over keeps going in the
// background and fills pi's own cache for the next discovery.
const DISCOVERY_TIMEOUT_MS = 8_000;

interface OrchCaches {
  pool: { at: number; pool: Promise<LocalPool> } | null;
  apiModels: Map<string, { at: number; model: Promise<string> }>;
}
const gc = globalThis as unknown as { __cmOrchCaches?: OrchCaches };
const caches: OrchCaches = (gc.__cmOrchCaches ??= { pool: null, apiModels: new Map() });

/** `p`, or `fallback` when it fails or takes longer than `ms`. */
function settleWithin<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
    timer.unref?.();
  });
  return Promise.race([p.catch(() => fallback), timeout]).finally(() => clearTimeout(timer));
}

/**
 * The Ollama models pi can drive as file-editing agents: none unless pi is
 * installed; only models with tool calling (the others stay text-only Ollama
 * workers). An Ollama outage yields none — the sync then still reports the
 * last good list, but pi could not reach those models either.
 */
async function discoverPiModels(): Promise<PiModel[]> {
  if (!(await piInfo()).installed) return [];
  const sync = await syncOllamaModels();
  return sync.error ? [] : sync.models.filter((m) => m.toolsOk);
}

function localPool(): Promise<LocalPool> {
  const now = Date.now();
  if (caches.pool && now - caches.pool.at < POOL_TTL_MS) return caches.pool.pool;
  const pool = Promise.all([
    onPath("claude"),
    geminiAvailable(),
    settleWithin(fetchOllamaModels(), DISCOVERY_TIMEOUT_MS, [] as ModelInfo[]),
    settleWithin(discoverPiModels(), DISCOVERY_TIMEOUT_MS, [] as PiModel[]),
  ]).then(([claude, gemini, ollama, pi]) => ({ claude, gemini, ollama, pi }));
  caches.pool = { at: now, pool };
  return pool;
}

// Model classification (CODER_MODEL, strongestGeneral, …) lives in
// orchestra-types.ts, shared with the org chart's preset logic.

// --- Workers --------------------------------------------------------------------

function claudeWorker(): Worker {
  return {
    id: "claude",
    kind: "claude-cli",
    model: "",
    label: "Claude Code",
    strengths: "Strongest at complex reasoning, software architecture, multi-file refactors, careful debugging and agentic file edits. Best for the hardest or most safety-critical coding subtasks. Higher cost.",
    editsFiles: true,
    local: false,
  };
}

function geminiWorker(): Worker {
  return {
    id: "gemini",
    kind: "gemini-cli",
    model: "",
    label: "Gemini CLI",
    strengths: "Very large context window and fast. Strong at broad codebase sweeps, boilerplate generation, wide-but-shallow changes, and reading lots of files at once. Can edit files. Free via login.",
    editsFiles: true,
    local: false,
  };
}

// Below this a local agent's context barely holds pi's prompt and a few files
// (the pi settings flag such models as well).
const SMALL_AGENT_CONTEXT = 16_384;

function piWorker(m: Pick<PiModel, "id" | "contextWindow">): Worker {
  const specialty = CODER_MODEL.test(m.id) ? "Coding specialist." : "General model.";
  const ctx = `~${Math.max(1, Math.round(m.contextWindow / 1024))}k tokens`;
  const scope = m.contextWindow < SMALL_AGENT_CONTEXT
    ? `Small context (${ctx}), so only for tiny, single-file changes.`
    : `Context ${ctx}, so best for focused, well-scoped changes; weaker than Claude Code or Gemini CLI on large or subtle multi-file work.`;
  return {
    id: `pi:${m.id}`,
    kind: "pi",
    model: m.id,
    label: `pi · ${m.id}`,
    strengths: `Local agent (free, runs offline) on ${m.id} via the pi coding agent: reads and edits project files and runs commands, like the CLI workers. ${specialty} ${scope}`,
    editsFiles: true,
    local: true,
  };
}

function ollamaWorker(model: string): Worker {
  return {
    id: `ollama:${model}`,
    kind: "ollama",
    model,
    label: `Local: ${model}`,
    strengths: CODER_MODEL.test(model)
      ? "Local coding specialist (free, runs offline). Great for self-contained functions/snippets, code explanation, and quick reviews. Cannot edit files directly — returns code/text that a file-editing worker or you applies."
      : "Local general model (free, runs offline). Good for analysis, summaries, drafting, and reviewing other workers' output. Cannot edit files directly.",
    editsFiles: false,
    local: true,
  };
}

// Build optional text-only workers from the user's client-configured cloud /
// custom OpenAI-compatible providers. Only included when usable (cloud needs a
// key; the custom endpoint needs a base URL), so the planner may route to them
// but is never forced to.
function buildApiWorkers(clientProviders: ClientProvider[] = []): Worker[] {
  const out: Worker[] = [];
  const seen = new Set<string>();
  for (const cp of clientProviders) {
    const def = getProvider(cp.id);
    if (!def || seen.has(cp.id)) continue;
    if (def.kind !== "openai" && def.kind !== "openai-local") continue;
    if (def.kind === "openai" && !cp.key) continue; // cloud needs a key
    const baseUrl = cp.baseUrl || def.baseUrl;
    if (!baseUrl) continue; // custom endpoint needs a base URL
    seen.add(cp.id);
    out.push({
      id: `api:${def.id}`,
      kind: "api",
      model: "",
      label: `API: ${def.label}`,
      strengths: `Cloud/remote text model via ${def.label} (OpenAI-compatible). Strong general LLM — use for analysis, drafting code/snippets, or reviewing other workers' output. Cannot edit files directly; returns text/code that a file-editing worker or the user applies.`,
      editsFiles: false,
      local: !!def.local,
      providerId: def.id,
      apiKey: cp.key || "",
      baseUrl,
    });
  }
  return out;
}

/**
 * The pool the planner routes to and runs execute on, with a strengths
 * profile per worker: the installed file-editing CLIs, a local coder + the
 * strongest general local Ollama model (text-only), a pi agent for EVERY local
 * model with tool calling (the role-less planner sees only the best two, see
 * plannerWorkers), and the user's configured cloud/custom APIs.
 */
export async function discoverWorkers(clientProviders: ClientProvider[] = []): Promise<Worker[]> {
  const pool = await localPool();
  const workers: Worker[] = [];
  if (pool.claude) workers.push(claudeWorker());
  if (pool.gemini) workers.push(geminiWorker());
  const coder = pool.ollama.find((m) => CODER_MODEL.test(m.id));
  const general = strongestGeneral(pool.ollama);
  for (const m of [coder, general]) if (m) workers.push(ollamaWorker(m.id));
  // Text-only Ollama workers come first: on a tie (same model) a role that
  // doesn't change files keeps the plain chat; only file work needs the agent.
  workers.push(...pool.pi.map(piWorker));
  workers.push(...buildApiWorkers(clientProviders));
  return workers;
}

/**
 * The full worker pool for the hybrid editor, the org chart and the presets:
 * the pool above plus EVERY installed Ollama chat model as a text worker, so
 * the user can route a subtask to any local model (e.g. gemma4:31b) — as a
 * file-editing pi agent when it supports tools, or as plain chat.
 */
export async function discoverAllWorkers(clientProviders: ClientProvider[] = []): Promise<Worker[]> {
  const [curated, pool] = await Promise.all([discoverWorkers(clientProviders), localPool()]);
  const out = curated.filter((w) => w.kind !== "ollama" && w.kind !== "pi");
  const ids = new Set(out.map((w) => w.id));
  for (const w of [...pool.ollama.map((m) => ollamaWorker(m.id)), ...curated.filter((x) => x.kind === "pi")]) {
    if (!ids.has(w.id)) { ids.add(w.id); out.push(w); }
  }
  return out;
}

// Resolve a worker id against a pool, building an Ollama worker on the fly for
// any ollama:<model> id (so manually-assigned local models always run). pi
// workers are never built on the fly: only discovery knows that pi is
// installed and the model can call tools — an unknown pi:<model> id falls
// back to Auto like any other unavailable worker.
function findWorker(workers: Worker[], id: string): Worker | null {
  const found = workers.find((w) => w.id === id);
  if (found) return found;
  if (id.startsWith("ollama:") && id.length > "ollama:".length) return ollamaWorker(id.slice("ollama:".length));
  return null;
}

function gateOn(session: AssistantSessionRow): boolean {
  return !!session.approvalMode && session.approvalMode !== "off";
}

/**
 * Whether a worker may change files in this session. Claude Code enforces the
 * approval gate (PreToolUse hook) and the sandbox; pi enforces the gate (its
 * approval extension) but cannot be sandboxed; gemini-cli enforces neither.
 * A worker that cannot enforce what the session asks for runs read-only
 * instead of bypassing it (see runCli).
 */
export function canEditFiles(w: Worker, session: AssistantSessionRow): boolean {
  if (!w.editsFiles) return false;
  if (w.kind === "claude-cli") return true;
  if (w.kind === "pi") return !session.sandbox;
  return !gateOn(session) && !session.sandbox;
}

// Why a file-capable worker runs read-only in this session (German notice).
const READ_ONLY_NOTES: Partial<Record<Worker["kind"], string>> = {
  "gemini-cli": "Gemini CLI läuft schreibgeschützt: Freigabe-Modus bzw. Sandbox lassen sich für Gemini nicht erzwingen.",
  pi: "pi (lokale Modelle) läuft in Sandbox-Sessions schreibgeschützt: die Sandbox lässt sich für pi nicht erzwingen.",
};

function bestEditor(workers: Worker[], session: AssistantSessionRow): Worker | null {
  return bestFileWorker(workers, (w) => canEditFiles(w, session)) ?? null;
}

interface Assignment {
  st: PlannedSubtask;
  worker: Worker;
}

/**
 * Binds every subtask to a runnable worker: unknown ids fall back to the best
 * file editor, and a subtask that edits files is moved off a text-only worker
 * when a file-capable one exists. Returns human-readable notes for each change.
 */
function assignWorkers(
  subtasks: PlannedSubtask[],
  workers: Worker[],
  session: AssistantSessionRow
): { assigned: Assignment[]; notes: string[] } {
  const editor = bestEditor(workers, session);
  const notes: string[] = [];
  // File-capable workers this session restricts (planned or moved off).
  const restricted = new Set<Worker["kind"]>();
  const assigned = subtasks.map((raw, i): Assignment => {
    const title = raw.title.trim() || `Teilaufgabe ${i + 1}`;
    let worker = findWorker(workers, raw.workerId);
    if (!worker) {
      worker = editor ?? workers[0] ?? null;
      if (!worker) throw new Error(NO_WORKER_MSG);
      notes.push(`Worker „${raw.workerId}“ ist nicht verfügbar — „${title}“ übernimmt ${worker.label}.`);
    }
    if (worker.editsFiles && !canEditFiles(worker, session)) restricted.add(worker.kind);
    if (raw.editsFiles && !canEditFiles(worker, session)) {
      if (editor) {
        notes.push(`„${title}“ ändert Dateien, ${worker.label} kann das nicht — übernimmt ${editor.label}.`);
        worker = editor;
      } else {
        notes.push(`⚠ „${title}“ soll Dateien ändern, aber kein Worker mit Dateizugriff ist verfügbar — ${worker.label} liefert nur Text, es werden keine Dateien geändert.`);
        // Say why when file-capable workers exist but this session restricts them.
        for (const w of workers) if (w.editsFiles && !canEditFiles(w, session)) restricted.add(w.kind);
      }
    }
    return { st: { ...raw, title, workerId: worker.id }, worker };
  });
  for (const kind of restricted) {
    const note = READ_ONLY_NOTES[kind];
    if (note) notes.push(note);
  }
  return { assigned, notes };
}

// The conductor's worker id: an explicit planner from the request wins (kept
// for older clients), then the orchestra's conductor; "" = Auto.
function conductorId(opts: OrchestrationOptions): string {
  const explicit = (opts.plannerWorkerId || "").trim();
  if (explicit && explicit !== "auto") return explicit;
  return opts.orchestra?.conductor.workerId.trim() || "";
}

// Which worker plans / synthesizes. An explicit id wins; otherwise Auto takes
// the strongest AVAILABLE model: Claude CLI > Gemini CLI > strongest general
// local model > a configured cloud API > anything left.
function resolvePlanner(workers: Worker[], plannerWorkerId?: string): { worker: Worker; note: string } | null {
  const id = (plannerWorkerId || "").trim();
  const r = resolveConductor(workers, id, (x) => findWorker(workers, x));
  if (!r.worker) return null;
  if (!r.auto) return { worker: r.worker, note: `Planer: ${r.worker.label}` };
  const prefix = r.unavailable ? `Planer „${id}“ ist nicht verfügbar — ` : "";
  return { worker: r.worker, note: `${prefix}Planer (Auto): ${r.worker.label}` };
}

/** Enabled roles of the orchestra; none means role-less (worker-based) planning. */
function activeRoles(orchestra?: OrchestraConfig | null): OrchestraRole[] {
  return (orchestra?.roles ?? []).filter((r) => r.enabled);
}

interface RoleScope {
  workers: Worker[];
  session: AssistantSessionRow;
  /** The conductor's worker — Auto for roles that don't change files. */
  conductor: Worker;
}

// The worker that runs a role in this session (configured, else Auto).
function roleWorker(role: OrchestraRole, scope: RoleScope): { worker: Worker; unavailable: boolean } {
  const r = resolveRoleWorker(role, scope.workers, {
    conductor: scope.conductor,
    canEdit: (w) => canEditFiles(w, scope.session),
    find: (id) => findWorker(scope.workers, id),
  });
  return { worker: r.worker ?? scope.conductor, unavailable: r.unavailable };
}

function roleFraming(role: OrchestraRole | undefined): string {
  if (!role) return "";
  const instructions = role.instructions.trim();
  return `You are the ${role.name} on this team.${instructions ? ` ${instructions}` : ""}\n\n`;
}

/**
 * The closing line of a work prompt (subtask or fix round). A read-only CLI
 * run (see cliAccess: work that changes no files, or a worker this session
 * restricts) is told so, and that the reply itself is the result — Claude
 * Code's plan mode otherwise tends to end in a plan approval request, which a
 * headless run cannot answer. `edits`: the run has the session's write access.
 */
function workingIn(cwd: string, worker: Worker, edits: boolean): string {
  const readOnly = worker.kind !== "ollama" && worker.kind !== "api" && !edits;
  return readOnly
    ? `(You are working in ${cwd} with read-only access: read the project as needed, leave the files as they are, and give your result in your reply.)`
    : `(You are working in ${cwd}.)`;
}

/** Keeps the start and the end of a long text (reports end with the summary). */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max / 4);
  return `${text.slice(0, head)}\n[…]\n${text.slice(text.length - (max - head))}`;
}

// --- Model calls ----------------------------------------------------------------

interface StreamOpts {
  signal?: AbortSignal;
  /** Incremental text as it streams. */
  onChunk?: (text: string) => void;
  /** Error events reported by a CLI run. */
  onError?: (msg: string) => void;
  onLog?: (msg: string) => void;
}

interface TextResult {
  text: string;
  costUsd: number;
  isError: boolean;
}

// Tools a read-only Gemini / pi worker may keep pre-approved.
const READ_ONLY_TOOLS = new Set(["Read", "Grep", "Glob", "WebSearch", "WebFetch"]);
// pi's read/grep/find/ls. pi has no implicit tools, while Claude Code reads the
// project without asking in every mode (plan included) — so every pi run gets
// them, or a pi reviewer or editor could not even open the files.
const PI_READ_TOOLS = ["Read", "Grep", "Glob"];
// Permission modes in which Claude Code changes files without asking.
const AUTO_EDIT_MODES = new Set(["acceptEdits", "auto", "bypassPermissions"]);

const csv = (s: string) => s.split(",").map((t) => t.trim()).filter(Boolean);
const joinTools = (...lists: string[][]) => [...new Set(lists.flat())].join(",");

/**
 * A file-editing pi worker's tools. pi never asks: the tools it gets are the
 * tools it may use, and of the permission modes only "plan" counts (the runner
 * drops bash/edit/write there). So it gets what Claude Code may do in the same
 * session — the session's tools plus the read tools; Edit/Write when edits
 * run without asking or through the approval gate (pi's extension then asks
 * for each one); Bash when commands run without asking (bypassPermissions) or
 * through the gate's "all" mode. Without this, the default tool list
 * (Read/Grep/Glob) left a pi editor unable to edit even under the gate.
 */
function piWorkTools(session: AssistantSessionRow): string {
  const gate = gateOn(session) ? session.approvalMode : "off";
  const extra: string[] = [];
  if (AUTO_EDIT_MODES.has(session.permissionMode) || gate === "edits" || gate === "all") extra.push("Edit", "Write");
  if (session.permissionMode === "bypassPermissions" || gate === "all") extra.push("Bash");
  return joinTools(csv(session.allowedTools), PI_READ_TOOLS, extra);
}

const CLI_PROVIDER: Partial<Record<Worker["kind"], string>> = { "claude-cli": "claude", "gemini-cli": "gemini", pi: "pi" };

/**
 * How a CLI worker runs:
 * - "work": a subtask that changes files — the session's mode, tools, gate
 *   and sandbox (read-only when the worker cannot enforce them);
 * - "read": a subtask that changes no files (editsFiles false, e.g. Architekt
 *   or Recherche) — reads the project with the session's read tools only;
 * - "text": planning, review, synthesis — plan mode without session tools.
 */
type CliMode = "work" | "read" | "text";

/** The runner row's mode/tools/gate/sandbox for a CLI worker run. */
function cliAccess(
  session: AssistantSessionRow,
  worker: Worker,
  mode: CliMode
): Pick<AssistantSessionRow, "permissionMode" | "allowedTools" | "approvalMode" | "sandbox" | "interactive"> {
  const pi = worker.kind === "pi";
  // Read-only, no gate: plan mode (pi keeps only its read tools there).
  if (mode === "text") return { permissionMode: "plan", allowedTools: pi ? joinTools(PI_READ_TOOLS) : "" };
  if (mode === "work" && canEditFiles(worker, session)) {
    return {
      permissionMode: session.permissionMode,
      allowedTools: pi ? piWorkTools(session) : session.allowedTools,
      approvalMode: session.approvalMode,
      sandbox: session.sandbox,
      interactive: false,
    };
  }
  // Read-only from here on: a "read" subtask, or a worker that cannot enforce
  // what the session asks for.
  const readTools = csv(session.allowedTools).filter((t) => READ_ONLY_TOOLS.has(t));
  if (worker.kind === "claude-cli") {
    // Plan mode reads the project but changes nothing and runs no commands
    // headless, so there is nothing for the gate to ask about — and a gate
    // "allow" could even let an edit through. The sandbox stays (it only
    // restricts). Only reached in "read" mode: Claude Code can always edit.
    return { permissionMode: "plan", allowedTools: readTools.join(","), approvalMode: "off", sandbox: session.sandbox, interactive: false };
  }
  if (pi) {
    // pi cannot be sandboxed (the runner refuses pi with `sandbox` set), so in
    // a sandboxed session it runs read-only instead: plan mode drops bash,
    // edit and write, which leaves nothing for the sandbox to contain. The
    // gate stays loaded as a second line of defence.
    return { permissionMode: "plan", allowedTools: joinTools(readTools, PI_READ_TOOLS), approvalMode: session.approvalMode, sandbox: false, interactive: false };
  }
  // Read-only Gemini: gemini-cli's --allowed-tools skip confirmation, so it
  // keeps only read tools, and "default" denies the rest headless. That leaves
  // nothing for the gate or the sandbox to hold back, and gemini-cli enforces
  // neither — the runner refuses Gemini with the gate set, which made every
  // Gemini worker of a gated session fail instead of running read-only.
  return { permissionMode: "default", allowedTools: readTools.join(","), approvalMode: "off", sandbox: false, interactive: false };
}

/**
 * What to put between a finished text block (`before`) and the next one
 * (`next`): enough newlines for a blank line, counting the ones both sides
 * already bring. Nothing before the first block.
 */
function paragraphBreak(before: string, next: string): string {
  if (!before) return "";
  const have = before.length - before.replace(/\n+$/, "").length + (next.length - next.replace(/^\n+/, "").length);
  return "\n".repeat(Math.max(0, 2 - have));
}

/**
 * Runs a CLI worker (Claude Code, Gemini CLI, pi). "work" = a subtask that
 * changes files, with the session's permission mode, tools, approval gate and
 * sandbox (approval cards reach the UI through the run hub); a worker that
 * cannot enforce the gate/sandbox runs read-only. "read" = a subtask that
 * changes no files: read-only with the session's read tools. "text" =
 * planning/review/synthesis: read-only plan mode, no gate. See cliAccess.
 */
async function runCli(
  session: AssistantSessionRow,
  worker: Worker,
  prompt: string,
  mode: CliMode,
  o: StreamOpts
): Promise<TextResult> {
  const row: AssistantSessionRow = {
    id: session.id, // same key as the run, so Stop kills this child too
    externalId: null, // fresh run; subtasks coordinate via the shared filesystem
    provider: CLI_PROVIDER[worker.kind] ?? "claude",
    model: worker.model,
    cwd: session.cwd,
    ...cliAccess(session, worker, mode),
  };
  let text = "";
  // Consecutive text events are pieces of ONE block: the runner streams token
  // deltas (Claude's --include-partial-messages, pi) coalesced into ~80 ms
  // chunks that can end mid-word, mid-JSON or mid-<verdict> tag, so they are
  // joined verbatim. A block ends only at another event (tool call, tool
  // result, thinking — a new assistant message follows a tool result), and
  // the next text then starts a new paragraph.
  let blockEnded = false;
  let reported = false;
  let failedResult = "";
  const res = await runTurn(row, prompt, undefined, (e) => {
    if (e.type === "text") {
      if (!e.content) return;
      const piece = (blockEnded ? paragraphBreak(text, e.content) : "") + e.content;
      blockEnded = false;
      text += piece;
      o.onChunk?.(piece);
      return;
    }
    if (e.type === "tool_use" || e.type === "tool_result" || e.type === "thinking") blockEnded = true;
    if (e.type === "error" && e.content) {
      reported = true;
      o.onError?.(e.content);
    } else if (e.type === "result" && e.isError && e.content) {
      failedResult = e.content;
    }
  }, { signal: o.signal });
  // Claude reports some failures (login, credits, limits) only as an error
  // result, without an error event — surface them instead of "(kein Output)".
  if (res.isError && !reported && failedResult.trim() && !o.signal?.aborted) {
    o.onError?.(failedResult.trim().slice(0, 2000));
  }
  return { text, costUsd: res.costUsd, isError: res.isError };
}

// Token streams are coalesced before they reach the run: every forwarded chunk
// is one buffered hub event, and per-token events would quickly push a long
// run past the replay buffer (late-attaching clients would miss the start).
const CHUNK_FLUSH_MS = 120;
const CHUNK_FLUSH_CHARS = 2_000;

/**
 * Consumes a provider stream, forwarding (coalesced) chunks. Returns the text
 * so far when the run is stopped (the providers take no AbortSignal yet, so
 * the pending read is abandoned rather than cancelled). Everything received is
 * forwarded through `onChunk` before this returns or throws.
 */
async function streamChat(provider: AIProvider, model: string, prompt: string, o: StreamOpts): Promise<string> {
  if (o.signal?.aborted) return "";
  const gen = provider.streamMessage({ messages: [{ role: "user", content: prompt }], model });
  let text = "";
  let pending = "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!pending) return;
    const piece = pending;
    pending = "";
    o.onChunk?.(piece);
  };
  let onAbort = () => {};
  const aborted = new Promise<"aborted">((resolve) => {
    if (o.signal?.aborted) return resolve("aborted");
    onAbort = () => resolve("aborted");
    o.signal?.addEventListener("abort", onAbort, { once: true });
  });
  try {
    for (;;) {
      const next = await Promise.race([gen.next(), aborted]);
      if (next === "aborted" || next.done) break;
      const chunk = next.value;
      if (chunk.type === "error") throw new Error(chunk.content || "Stream-Fehler");
      if (chunk.type === "text" && chunk.content) {
        text += chunk.content;
        if (!o.onChunk) continue;
        pending += chunk.content;
        if (pending.length >= CHUNK_FLUSH_CHARS) flush();
        else timer ??= setTimeout(flush, CHUNK_FLUSH_MS);
      }
    }
  } finally {
    flush();
    o.signal?.removeEventListener("abort", onAbort);
    gen.return(undefined).catch(() => {});
  }
  return text;
}

// Ids that are not chat models (OpenAI-compatible /models lists mix them in).
const NON_CHAT_MODEL = /embed|embedding|whisper|tts|dall-e|image|moderation|rerank|audio|vision-preview|guard|realtime|transcribe/i;
// Known chat families, roughly strongest first; unknown ids rank after these.
const CHAT_FAMILIES = [
  /gpt-5/i, /claude/i, /gemini/i, /grok/i, /gpt-4\.1/i, /kimi/i, /deepseek/i, /qwen/i, /glm/i,
  /gpt-oss/i, /llama-?4/i, /gpt-4o/i, /mistral-(large|medium)/i, /llama-?3/i, /mistral|mixtral/i,
  /gemma/i, /command/i, /sonar/i, /phi/i, /llama/i,
];
// Stable aliases for catalog providers without staticModels.
const DEFAULT_CHAT_MODEL: Record<string, string> = {
  openrouter: "openrouter/auto",
  mistral: "mistral-large-latest",
};

function pickChatModel(ids: string[], preferred?: string): string | null {
  const usable = ids.filter((id) => !NON_CHAT_MODEL.test(id));
  if (!usable.length) return null;
  if (preferred && usable.includes(preferred)) return preferred;
  const family = (id: string) => {
    const i = CHAT_FAMILIES.findIndex((re) => re.test(id));
    return i < 0 ? CHAT_FAMILIES.length : i;
  };
  return usable.sort((a, b) =>
    family(a) - family(b) || paramBillions({ id: b }) - paramBillions({ id: a }) || a.length - b.length || a.localeCompare(b)
  )[0];
}

/**
 * Picks the chat model for an API worker: the catalog's default model, else the
 * best chat model from the live /models list (non-chat ids filtered out), else
 * a stable per-provider alias. Fails with a clear error when nothing fits.
 */
function resolveApiModel(worker: Worker): Promise<string> {
  if (worker.model) return Promise.resolve(worker.model);
  const providerId = worker.providerId || "";
  const def = getProvider(providerId);
  if (def?.staticModels?.length) return Promise.resolve(def.staticModels[0].id);

  const key = `${providerId}|${worker.baseUrl || ""}`;
  const hit = caches.apiModels.get(key);
  if (hit && Date.now() - hit.at < API_MODEL_TTL_MS) return hit.model;
  const model = (async () => {
    const live = def?.noModelsEndpoint
      ? []
      : await fetchOpenAICompatModels(providerId, worker.baseUrl || "", worker.apiKey);
    const alias = DEFAULT_CHAT_MODEL[providerId];
    const picked = live.length ? pickChatModel(live.map((m) => m.id), alias) : alias ?? null;
    if (!picked) {
      throw new Error(
        live.length
          ? `${worker.label}: kein Chat-Modell gefunden — die Modell-Liste enthält nur Nicht-Chat-Modelle (Embedding, Audio, Bild …).`
          : `${worker.label}: Modell-Liste nicht abrufbar (Endpoint/Key prüfen) und kein Standard-Modell bekannt.`
      );
    }
    return picked;
  })();
  caches.apiModels.set(key, { at: Date.now(), model });
  model.catch(() => { if (caches.apiModels.get(key)?.model === model) caches.apiModels.delete(key); });
  return model;
}

/** Resolves to `null` as soon as `signal` aborts, instead of waiting for `p`. */
function unlessAborted<T>(p: Promise<T>, signal?: AbortSignal): Promise<T | null> {
  if (!signal) return p;
  if (signal.aborted) return Promise.resolve(null);
  let onAbort = () => {};
  const aborted = new Promise<null>((resolve) => {
    onAbort = () => resolve(null);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  return Promise.race([p, aborted]).finally(() => signal.removeEventListener("abort", onAbort));
}

/** Streams a text-only worker (local Ollama or cloud/custom API). Throws on failure. */
async function runChat(worker: Worker, prompt: string, o: StreamOpts): Promise<string> {
  if (worker.kind === "ollama") {
    return streamChat(createProvider("ollama", ""), worker.model, prompt, o);
  }
  // The /models lookup is not cancellable — don't let it hold up a Stop.
  const model = await unlessAborted(resolveApiModel(worker), o.signal);
  if (model === null) return "";
  if (!worker.model) o.onLog?.(`${worker.label}: Modell ${model}`);
  const provider = createProvider(worker.providerId || "", worker.apiKey || "", { baseUrl: worker.baseUrl });
  return streamChat(provider, model, prompt, o);
}

// Runs a worker for plain TEXT output (planning / synthesis) on ANY configured
// model: CLI workers run a tool-less turn; Ollama/API workers a streamed chat.
async function runText(session: AssistantSessionRow, worker: Worker, prompt: string, o: StreamOpts): Promise<TextResult> {
  if (worker.kind === "ollama" || worker.kind === "api") {
    return { text: await runChat(worker, prompt, o), costUsd: 0, isError: false };
  }
  return runCli(session, worker, prompt, "text", o);
}

// --- Planner --------------------------------------------------------------------

// Mirrors plannedSubtaskSchema / orchestrateRunSchema in validation/schemas.ts.
// Worker ids share the orchestra's limit: "pi:"/"ollama:" + an Ollama id of
// up to 200 characters must survive planning uncut, or the subtask would land
// on another worker.
const LIMITS = {
  subtasks: 20, id: 50, title: 300, description: 20_000, dependsOn: 20,
  workerId: ORCHESTRA_LIMITS.workerId,
  roleId: ORCHESTRA_LIMITS.roleId,
};

function extractJson(s: string): string {
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : s;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}

export interface PlanOptions extends OrchestrationOptions {
  signal?: AbortSignal;
  onLog?: (msg: string) => void;
}

// The user's standing guidance for the conductor (planning and summary).
function conductorGuidance(orchestra?: OrchestraConfig | null): string {
  const instructions = orchestra?.conductor.instructions.trim();
  return instructions ? `\nAdditional instructions from the user for you as the conductor:\n${instructions}\n` : "";
}

/**
 * The workers the role-less planner is offered: every pi agent would flood the
 * prompt with near-identical local entries, so only the strongest coder and the
 * strongest general one are listed (like the curated Ollama pair). Assigning
 * any other pi worker (hybrid editor, roles) still runs.
 */
function plannerWorkers(workers: Worker[]): Worker[] {
  const pi = workers.filter((w) => w.kind === "pi");
  if (pi.length <= 2) return workers;
  const keep = new Set([strongestWorker(pi.filter((w) => CODER_MODEL.test(w.model))), strongestWorker(pi, true)]);
  return workers.filter((w) => w.kind !== "pi" || keep.has(w));
}

// Role-less planning: the planner routes each subtask to a worker directly.
function workerPlannerPrompt(session: AssistantSessionRow, task: string, workers: Worker[], prefLine: string, guidance: string): string {
  const profile = plannerWorkers(workers)
    .map((w) => {
      const readOnly = w.editsFiles && !canEditFiles(w, session);
      return `- ${w.id} (${w.label}, editsFiles=${canEditFiles(w, session)}): ${w.strengths}${readOnly ? " (Read-only in this session.)" : ""}`;
    })
    .join("\n");

  return `You are an orchestration planner for a coding assistant working in the directory ${session.cwd}.${prefLine}
Plan from the task text alone: the workers read the project themselves when they run, so using tools or exploring files now would only delay the plan. A program parses your reply, so answer with a single JSON object and nothing else (no preamble, explanation or markdown fences).

Split the user's task into as few subtasks as get the job done well, and give each one to the worker whose strengths fit it best.

Available workers:
${profile}

How to plan:
- A simple question, status check or single action becomes exactly one subtask for a worker with editsFiles=true; that worker reads the project and answers or acts.
- Otherwise use 2-5 subtasks.
- A subtask that creates, changes or deletes files or runs commands (tests, builds, git) sets editsFiles to true and needs a worker with editsFiles=true, because the other workers return text only. A subtask with editsFiles false runs read-only: it can read the project but not change it or run commands.
- Workers with editsFiles=false ("ollama:" local models and "api:" cloud models) can't open the project, so they are optional helpers for self-contained work: analysis, drafting snippets or reviewing other workers' output. Leaving them out is fine.
- Prefer claude for the hardest reasoning and architecture, gemini for broad, large-context sweeps, "pi:" local agents for free, well-scoped file changes, and local or api text models for cheap isolated work.
- List in dependsOn the ids of subtasks that must finish first; independent subtasks get [].

Reply with this JSON shape:
{"subtasks":[{"id":"s1","title":"<short title>","description":"<clear, self-contained instruction for the worker>","workerId":"<one of the worker ids>","dependsOn":[],"editsFiles":true|false}]}
${guidance}
Task:
${task}`;
}

// Role-based planning: the planner assigns each subtask to an enabled role;
// the role decides the worker.
function rolePlannerPrompt(
  session: AssistantSessionRow,
  task: string,
  roles: OrchestraRole[],
  orchestra: OrchestraConfig,
  prefLine: string,
  guidance: string
): string {
  let anyReview = false;
  const team = roles
    .map((r) => {
      const reviewer = reviewerFor(orchestra, r);
      if (reviewer) anyReview = true;
      const traits = [
        r.editsFiles ? "changes files" : "does not change files",
        reviewer ? `reviewed automatically by ${reviewer.name}` : "",
      ].filter(Boolean).join("; ");
      const about = r.description.trim().replace(/\s+/g, " ") || r.name;
      return `- ${r.id} — ${r.name} (${traits}): ${about}`;
    })
    .join("\n");

  return `You are the conductor of a small team of AI coding agents working in the directory ${session.cwd}. As the orchestration planner, you split the user's task into subtasks and give each one to the team role that fits it best.${prefLine}
Plan from the task text alone: the team members read the project themselves when they run, so exploring files now would only delay the plan. A program parses your reply, so answer with a single JSON object and nothing else (no prose, no markdown fences).

Team roles:
${team}

How to plan:
- A simple question, status check or single action becomes exactly one subtask for the best-fitting role.
- Otherwise use 2-5 subtasks; fewer is better as long as the job gets done well.
- Give work that creates, changes or deletes files or runs commands (tests, builds, git) to a role that changes files; the other roles only read the project and report back text.${anyReview ? "\n- Work of a role marked \"reviewed automatically\" gets a review right after its subtask, so plan no separate review subtask for it." : ""}
- Write each description as a self-contained instruction: the role sees only its description and the results of the subtasks it depends on.
- List in dependsOn the ids of subtasks that must finish first; independent subtasks get [].

Reply with this JSON shape:
{"subtasks":[{"id":"s1","title":"<short title>","roleId":"<one of the role ids>","description":"<self-contained instruction>","dependsOn":[]}]}
${guidance}
Task:
${task}`;
}

// Binds planned subtasks to roles: the worker comes from the role (configured,
// else Auto) and the role decides whether the subtask changes files. A subtask
// without a known enabled role keeps the planner's worker (or Auto).
function bindRoles(
  subtasks: PlannedSubtask[],
  roles: OrchestraRole[],
  scope: RoleScope,
  onLog?: (msg: string) => void
): PlannedSubtask[] {
  const byId = new Map(roles.map((r) => [r.id, r]));
  // Planners sometimes answer with the display name ("Coder") instead of the id.
  const byName = new Map(roles.map((r) => [r.name.trim().toLowerCase(), r]));
  const noted = new Set<string>();
  return subtasks.map((st) => {
    const key = st.roleId?.trim() ?? "";
    const role = key ? byId.get(key) ?? byName.get(key.toLowerCase()) : undefined;
    if (!role) {
      if (st.roleId) onLog?.(`Rolle „${st.roleId}“ ist unbekannt oder deaktiviert — „${st.title}“ läuft ohne Rolle.`);
      const worker =
        findWorker(scope.workers, st.workerId) ??
        (st.editsFiles ? bestEditor(scope.workers, scope.session) : null) ??
        scope.conductor;
      return { ...st, roleId: undefined, workerId: worker.id };
    }
    const { worker, unavailable } = roleWorker(role, scope);
    if (unavailable && !noted.has(role.id)) {
      noted.add(role.id);
      onLog?.(`Rolle „${role.name}“: Modell „${role.workerId.trim()}“ ist nicht verfügbar — automatisch gewählt: ${worker.label}.`);
    }
    return { ...st, roleId: role.id, workerId: worker.id, editsFiles: role.editsFiles };
  });
}

async function plan(
  session: AssistantSessionRow,
  task: string,
  workers: Worker[],
  opts: PlanOptions
): Promise<{ subtasks: PlannedSubtask[]; costUsd: number }> {
  const roles = activeRoles(opts.orchestra);
  const preference = opts.preference?.trim();
  const prefLine = preference
    ? `\nRouting preference from the user (honor it where quality allows): ${preference}\n`
    : "";
  const guidance = conductorGuidance(opts.orchestra);

  const choice = resolvePlanner(workers, conductorId(opts));
  if (!choice) throw new Error(NO_WORKER_MSG);
  opts.onLog?.(choice.note);
  const scope: RoleScope = { workers, session, conductor: choice.worker };

  const plannerPrompt = roles.length && opts.orchestra
    ? rolePlannerPrompt(session, task, roles, opts.orchestra, prefLine, guidance)
    : workerPlannerPrompt(session, task, workers, prefLine, guidance);

  // Fallback: if the planner narrated instead of returning JSON (common for
  // simple questions), don't fail — run the whole task as a single subtask on a
  // file-capable worker, which can read the project and answer/act. It runs
  // without a role (no framing, no review loop), as the task may be a plain
  // question; with roles, the first role that changes files lends its worker.
  const fallback = (): PlannedSubtask[] => {
    const role = roles.find((r) => r.editsFiles);
    const fromRole = role ? roleWorker(role, scope).worker : null;
    const w = (fromRole && canEditFiles(fromRole, session) ? fromRole : null) ?? bestEditor(workers, session) ?? fromRole ?? workers[0];
    return [{ id: "s1", title: "Aufgabe bearbeiten", description: task, workerId: w.id, dependsOn: [], editsFiles: canEditFiles(w, session) }];
  };

  let raw = "";
  let costUsd = 0;
  let failure = "";
  const fallbackWith = (reason: string) => {
    if (!opts.signal?.aborted) opts.onLog?.(`${reason} — Aufgabe läuft als eine Teilaufgabe.`);
    return { subtasks: fallback(), costUsd };
  };
  try {
    const r = await runText(session, choice.worker, plannerPrompt, {
      signal: opts.signal,
      onLog: opts.onLog,
      onError: (m) => { failure ||= m; },
    });
    raw = r.text;
    costUsd = r.costUsd;
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err);
  }
  if (!raw.trim() && failure) return fallbackWith(`Planung mit ${choice.worker.label} fehlgeschlagen (${failure.slice(0, 300)})`);

  let parsed: { subtasks?: unknown } | null;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch {
    return fallbackWith("Planer lieferte kein gültiges JSON");
  }
  const entries = (Array.isArray(parsed?.subtasks) ? (parsed!.subtasks as unknown[]) : [])
    .filter((s): s is Partial<PlannedSubtask> => !!s && typeof s === "object" && !Array.isArray(s));
  if (entries.length > LIMITS.subtasks) {
    opts.onLog?.(`Planer lieferte ${entries.length} Teilaufgaben — nur die ersten ${LIMITS.subtasks} werden übernommen.`);
  }
  const list = entries.slice(0, LIMITS.subtasks);
  // Clamped to the hybrid-run schema (orchestrateRunSchema) so an edited plan
  // round-trips through POST …/orchestrate/run without a validation error.
  const str = (v: unknown, max: number) => (v == null ? "" : String(v)).slice(0, max);
  const subtasks = list.map((s, i): PlannedSubtask => {
    const roleId = roles.length ? str(s.roleId, LIMITS.roleId) : "";
    return {
      id: str(s.id, LIMITS.id) || `s${i + 1}`,
      title: str(s.title, LIMITS.title) || `Teilaufgabe ${i + 1}`,
      description: str(s.description, LIMITS.description),
      workerId: str(s.workerId, LIMITS.workerId),
      dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn.slice(0, LIMITS.dependsOn).map((d) => str(d, LIMITS.id)) : [],
      editsFiles: !!s.editsFiles,
      ...(roleId ? { roleId } : {}),
    };
  });
  if (subtasks.length === 0) return { subtasks: fallback(), costUsd };
  return { subtasks: roles.length ? bindRoles(subtasks, roles, scope, opts.onLog) : subtasks, costUsd };
}

// Planner output and edited plans may repeat an id; ids key the live events and
// the dependency graph, so duplicates get a suffix (references keep the first).
function uniqueIds(subtasks: PlannedSubtask[]): PlannedSubtask[] {
  const seen = new Set<string>();
  return subtasks.map((s) => {
    let id = s.id;
    for (let n = 2; seen.has(id); n++) id = `${s.id.slice(0, LIMITS.id - 4)}-${n}`;
    seen.add(id);
    return id === s.id ? s : { ...s, id };
  });
}

// Topologically order subtasks by dependsOn (stable; ignores broken refs).
function orderSubtasks(input: PlannedSubtask[]): PlannedSubtask[] {
  const subtasks = uniqueIds(input);
  const byId = new Map(subtasks.map((s) => [s.id, s]));
  const done = new Set<string>();
  const out: PlannedSubtask[] = [];
  let guard = 0;
  while (out.length < subtasks.length && guard++ < subtasks.length * 2) {
    for (const s of subtasks) {
      if (done.has(s.id)) continue;
      if (s.dependsOn.every((d) => !byId.has(d) || done.has(d))) {
        out.push(s);
        done.add(s.id);
      }
    }
  }
  // Append any left over (cycles) in original order.
  for (const s of subtasks) if (!done.has(s.id)) out.push(s);
  return out;
}

/**
 * Plans without executing — used by the hybrid mode so the user can edit
 * assignments. Returned subtasks are already bound to runnable workers.
 */
export async function planSubtasks(
  session: AssistantSessionRow,
  task: string,
  opts: PlanOptions = {}
): Promise<{ workers: Worker[]; subtasks: PlannedSubtask[]; costUsd: number }> {
  const workers = await discoverWorkers(opts.clientProviders);
  if (!workers.length) throw new Error(NO_WORKER_MSG);
  const planned = await plan(session, task, workers, opts);
  const { assigned, notes } = assignWorkers(orderSubtasks(planned.subtasks), workers, session);
  for (const n of notes) opts.onLog?.(n);
  // The single-subtask fallback carries the whole task; keep it within the
  // run schema so the edited plan can be submitted.
  const subtasks = assigned.map((a) => ({ ...a.st, description: a.st.description.slice(0, LIMITS.description) }));
  return { workers, subtasks, costUsd: planned.costUsd };
}

// --- Execution ------------------------------------------------------------------

interface ReviewContext {
  task: string;
  st: PlannedSubtask;
  author: OrchestraRole;
  authorWorker: Worker;
  reviewer: OrchestraRole;
  reviewerWorker: Worker;
  cwd: string;
  /** The author changed files in the working directory. */
  authorEdits: boolean;
}

// Fresh-context review of one subtask. CLI reviewers run read-only (plan mode)
// and are asked to check the actual files instead of trusting the report.
function reviewPrompt(c: ReviewContext, report: string, round: number, maxRounds: number): string {
  const access = c.reviewerWorker.editsFiles
    ? c.authorEdits
      ? `The changes are in the working directory ${c.cwd}. Read the affected files (and their callers where relevant) to check the actual code rather than relying on the report. Your access is read-only here, so leave the files as they are.`
      : `You can read the project in ${c.cwd} to verify the claims in the report. Your access is read-only here, so leave the files as they are.`
    : "You can't open the project files here, so judge the report and any code it contains.";
  return `${roleFraming(c.reviewer)}Review round ${round} of ${maxRounds}. Look at the result with fresh eyes and judge it on its own merits against the requirements below.

<task>
${clip(c.task, 4000)}
</task>

<subtask author="${c.author.name} (${c.authorWorker.label})">
${c.st.title}
${clip(c.st.description.trim(), 6000)}
</subtask>

Report from the ${c.author.name}:
<report>
${clip(report.trim(), 8000) || "(no text output)"}
</report>

${access}

Check:
1. Does the result meet every requirement of the subtask?
2. Is it correct — logic, edge cases, error handling, types, security?
3. Does anything the task relies on break or go missing?

Report only gaps that affect correctness or the stated requirements, each with file and line where you can see them and a concrete fix. Leave out style preferences and optional improvements, so the author can focus on what matters.

End with exactly one final line: <verdict>pass</verdict> when nothing blocking remains, or <verdict>changes</verdict> when the author needs to fix something. A program reads that line to decide whether the author gets another round, so write the tag exactly once.`;
}

// The author's fix round after a "changes" verdict (fresh context as well).
function fixPrompt(c: ReviewContext, findings: string, previous: string, round: number): string {
  const how = c.authorEdits
    ? `Fix each finding in the working directory ${c.cwd} and verify the fix (type check, linter or tests where available).`
    : "Return the corrected, complete result.";
  return `${roleFraming(c.author)}The ${c.reviewer.name} reviewed your work on this subtask (review round ${round}) and found gaps to fix.

<task>
${clip(c.task, 4000)}
</task>

<subtask>
${c.st.title}
${clip(c.st.description.trim(), 6000)}
</subtask>

<previous_report>
${clip(previous.trim(), 6000) || "(no text output)"}
</previous_report>

<findings reviewer="${c.reviewer.name}">
${clip(findings.trim(), 8000)}
</findings>

${how} If you disagree with a finding, explain briefly why instead of changing the code, so the next review can weigh your reasoning. Finish with a short summary of what you changed.

${workingIn(c.cwd, c.authorWorker, c.authorEdits)}`;
}

/**
 * Executes a plan: subtasks run sequentially in dependency order (sharing the
 * working directory), each framed by its orchestra role and — when the role
 * has a review loop — reviewed (and fixed) before the next one starts; then
 * the conductor writes a streamed summary. Emits live events, persists
 * transcript rows in order, and stops cleanly (no further subtasks, reviews or
 * synthesis) once `io.signal` aborts.
 */
export async function executePlan(
  session: AssistantSessionRow,
  task: string,
  subtasks: PlannedSubtask[],
  io: OrchestrationIO,
  opts: OrchestrationOptions = {}
): Promise<OrchestrationResult> {
  const { emit, signal } = io;
  const record = io.record ?? (() => {});
  const log = (content: string, persist = false) => {
    emit({ type: "log", content, ...(persist ? { notice: true } : {}) });
    if (persist) record({ role: "system", content });
  };
  let costUsd = 0;
  let isError = false;
  const stop = (): OrchestrationResult => {
    log(STOPPED_MSG);
    return { costUsd, isError, stopped: true };
  };

  const workers = await discoverWorkers(opts.clientProviders);
  log(`Worker: ${workers.map((w) => w.id).join(", ") || "—"}`);

  const { assigned, notes } = assignWorkers(orderSubtasks(subtasks), workers, session);
  // Every configured role may frame a subtask — an edited plan can still name
  // a role that was disabled in the meantime. A role that no longer exists is
  // dropped, so the plan event never references an unknown role.
  const orchestra = opts.orchestra ?? null;
  const roles = new Map((orchestra?.roles ?? []).map((r) => [r.id, r]));
  for (const a of assigned) {
    if (a.st.roleId && !roles.has(a.st.roleId)) {
      notes.push(`Rolle „${a.st.roleId}“ gibt es nicht (mehr) — „${a.st.title}“ läuft ohne Rolle.`);
      a.st = { ...a.st, roleId: undefined };
    }
  }
  const planned = assigned.map((a) => a.st);
  const planRoles = (orchestra?.roles ?? [])
    .filter((r) => planned.some((s) => s.roleId === r.id))
    .map((r) => ({ id: r.id, name: r.name, editsFiles: r.editsFiles }));
  const withRoles = planRoles.length ? { roles: planRoles } : {};
  emit({ type: "plan", subtasks: planned, ...withRoles });
  record({
    role: "plan",
    content: task,
    meta: JSON.stringify({ subtasks: planned, workers: workers.map((w) => ({ id: w.id, label: w.label })), ...withRoles }),
  });
  for (const n of notes) log(n, true);

  // The conductor writes the summary and runs Auto roles that don't change files.
  const conductor = resolvePlanner(workers, conductorId(opts));
  const scope: RoleScope | null = conductor ? { workers, session, conductor: conductor.worker } : null;

  // Real work: a subtask that changes files runs CLIs with the session's
  // tools, gate and sandbox; one that doesn't (editsFiles false — Architekt,
  // Recherche, …) runs them read-only, still able to read the project. Text
  // workers stream a chat. Failures are reported through `stream.onError`.
  const runWork = async (st: PlannedSubtask, worker: Worker, prompt: string, stream: StreamOpts): Promise<void> => {
    try {
      if (worker.kind === "ollama" || worker.kind === "api") {
        await runChat(worker, prompt, stream);
      } else {
        const r = await runCli(session, worker, prompt, st.editsFiles ? "work" : "read", stream);
        costUsd += r.costUsd;
        if (r.isError && !signal?.aborted) isError = true;
      }
    } catch (err) {
      stream.onError?.(`${worker.label} fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Review loop: the reviewer role checks the subtask; on "changes" the author
  // fixes the findings, up to the role's maxRounds. Returns the author's output
  // including fixes, or null when the review could not start.
  const reviewLoop = async (
    st: PlannedSubtask,
    role: OrchestraRole,
    author: Worker,
    reviewer: OrchestraRole,
    authorText: string
  ): Promise<{ output: string; verdict: ReviewVerdict; rounds: number } | null> => {
    if (!scope) {
      log(`Prüfung von „${st.title}“ übersprungen: kein Modell verfügbar.`);
      return null;
    }
    const { worker: reviewerWorker, unavailable } = roleWorker(reviewer, scope);
    if (unavailable) {
      log(`Rolle „${reviewer.name}“: Modell „${reviewer.workerId.trim()}“ ist nicht verfügbar — automatisch gewählt: ${reviewerWorker.label}.`);
    }
    const c: ReviewContext = {
      task, st, author: role, authorWorker: author, reviewer, reviewerWorker, cwd: session.cwd,
      authorEdits: st.editsFiles && canEditFiles(author, session),
    };
    const maxRounds = clampRounds(role.reviewLoop.maxRounds);
    let output = authorText;
    let latest = authorText;
    let verdict: ReviewVerdict = "unknown";
    let rounds = 0;
    for (let round = 1; round <= maxRounds; round++) {
      if (signal?.aborted) break;
      rounds = round;
      emit({
        type: "review_start", subtaskId: st.id, round, maxRounds,
        reviewerRoleId: reviewer.id, reviewerRoleName: reviewer.name, reviewerLabel: reviewerWorker.label,
      });
      let review = "";
      const reviewErrors: string[] = [];
      try {
        const r = await runText(session, reviewerWorker, reviewPrompt(c, latest, round, maxRounds), {
          signal,
          onChunk: (chunk) => {
            review += chunk;
            emit({ type: "review_text", subtaskId: st.id, round, content: chunk });
          },
          onError: (m) => reviewErrors.push(m),
          onLog: (m) => log(m),
        });
        costUsd += r.costUsd;
        if (r.isError && !review.trim() && !reviewErrors.length) reviewErrors.push("kein Output");
      } catch (err) {
        reviewErrors.push(err instanceof Error ? err.message : String(err));
      }
      verdict = parseVerdict(review);
      if (review.trim()) {
        record({
          role: "assistant",
          content: review.trim(),
          meta: JSON.stringify({
            subtaskId: st.id, review: true, round, verdict,
            worker: reviewerWorker.label, workerId: reviewerWorker.id, roleId: reviewer.id, roleName: reviewer.name,
          }),
        });
      }
      if (reviewErrors.length && !signal?.aborted) {
        isError = true;
        const msg = `Prüfung von „${st.title}“ fehlgeschlagen (${reviewerWorker.label}): ${reviewErrors[0]}`;
        emit({ type: "error", content: msg, subtaskId: st.id });
        record({ role: "error", content: msg.slice(0, 4000), meta: JSON.stringify({ subtaskId: st.id, review: true, round }) });
      }
      emit({ type: "review_end", subtaskId: st.id, round, verdict });
      if (signal?.aborted) break;
      if (verdict === "unknown" && review.trim() && !reviewErrors.length) {
        log(`Prüfung von „${st.title}“ ohne eindeutiges Urteil — keine Nachbesserung.`, true);
      }
      if (verdict !== "changes") break;
      if (round === maxRounds) {
        log(`Prüfschleife: „${st.title}“ hat nach ${maxRounds} ${maxRounds === 1 ? "Runde" : "Runden"} noch offene Punkte.`, true);
        break;
      }

      // Fix round on the author's worker; streams into the subtask.
      let fix = "";
      const fixErrors: string[] = [];
      await runWork(st, author, fixPrompt(c, review, latest, round), {
        signal,
        onChunk: (chunk) => {
          emit({ type: "subtask_text", subtaskId: st.id, content: fix ? chunk : `\n\n${chunk}`, fixRound: round });
          fix += chunk;
        },
        onError: (m) => {
          if (signal?.aborted) return;
          fixErrors.push(m);
          emit({ type: "error", content: m, subtaskId: st.id });
        },
        onLog: (m) => log(m),
      });
      if (fix.trim() || (!fixErrors.length && !signal?.aborted)) {
        record({
          role: "assistant",
          content: fix.trim() || "(kein Output)",
          meta: JSON.stringify({
            subtaskId: st.id, title: st.title, worker: author.label, workerId: author.id,
            roleId: role.id, roleName: role.name, fixRound: round,
          }),
        });
      }
      for (const e of fixErrors) record({ role: "error", content: e.slice(0, 4000), meta: JSON.stringify({ subtaskId: st.id, fixRound: round }) });
      if (fix.trim()) {
        output += `\n\n${fix}`;
        latest = fix;
      }
      if (fixErrors.length) {
        isError = true;
        break;
      }
    }
    return { output, verdict, rounds };
  };

  const results = new Map<string, string>();
  const reviews = new Map<string, { reviewer: string; verdict: ReviewVerdict; rounds: number }>();

  for (const { st, worker } of assigned) {
    if (signal?.aborted) return stop();
    const role = st.roleId ? roles.get(st.roleId) : undefined;
    const roleInfo = role ? { roleId: role.id, roleName: role.name } : {};
    emit({ type: "subtask_start", subtaskId: st.id, title: st.title, workerId: worker.id, workerLabel: worker.label, ...roleInfo });

    // Provide upstream results as context (file edits are already on disk for CLIs,
    // but a text summary helps both CLI and local workers stay aligned).
    const deps = st.dependsOn.map((d) => results.get(d)).filter(Boolean);
    const context = deps.length
      ? `\n\nContext from previous subtasks:\n${deps.map((c, i) => `[${i + 1}] ${clip(String(c), 1500)}`).join("\n")}`
      : "";
    const body = st.description.trim() || st.title;
    // Same condition as runWork → cliAccess: write access only for a subtask
    // that changes files on a worker that may do so in this session.
    const where = workingIn(session.cwd, worker, st.editsFiles && canEditFiles(worker, session));
    const prompt = `${role ? `${roleFraming(role)}Your subtask:\n${body}` : body}${context}\n\n${where}`;

    const errors: string[] = [];
    const fail = (msg: string) => {
      if (signal?.aborted) return; // the stop itself is reported once
      errors.push(msg);
      emit({ type: "error", content: msg, subtaskId: st.id });
    };
    // Collected from the live chunks, so partial output survives a failed or
    // stopped stream and is persisted exactly as the UI showed it.
    let text = "";
    await runWork(st, worker, prompt, {
      signal,
      onChunk: (c) => {
        text += c;
        emit({ type: "subtask_text", subtaskId: st.id, content: c });
      },
      onError: fail,
      onLog: (m) => log(m),
    });
    if (errors.length) isError = true;

    if (text.trim() || (!errors.length && !signal?.aborted)) {
      record({
        role: "assistant",
        content: text.trim() || "(kein Output)",
        meta: JSON.stringify({ subtaskId: st.id, title: st.title, worker: worker.label, workerId: worker.id, ...roleInfo }),
      });
    }
    for (const e of errors) record({ role: "error", content: e.slice(0, 4000), meta: JSON.stringify({ subtaskId: st.id }) });

    let output = text;
    const reviewer = role && orchestra ? reviewerFor(orchestra, role) : null;
    if (role && reviewer && !signal?.aborted) {
      if (errors.length) {
        log(`Prüfung von „${st.title}“ übersprungen: die Teilaufgabe ist fehlgeschlagen.`);
      } else {
        const outcome = await reviewLoop(st, role, worker, reviewer, text);
        if (outcome) {
          output = outcome.output;
          if (outcome.rounds) reviews.set(st.id, { reviewer: reviewer.name, verdict: outcome.verdict, rounds: outcome.rounds });
        }
      }
    }
    results.set(st.id, output);
    emit({ type: "subtask_end", subtaskId: st.id, workerLabel: worker.label, ...roleInfo });
  }

  if (signal?.aborted) return stop();

  // Synthesis: a concise wrap-up of what the workers produced, streamed on the
  // conductor's model (or Auto) — not hardwired to Claude.
  if (!conductor) {
    log("Keine Zusammenfassung: kein Modell verfügbar.");
    return { costUsd, isError, stopped: false };
  }
  const summaryInput = assigned
    .map(({ st, worker }) => {
      const role = st.roleId ? roles.get(st.roleId) : undefined;
      const rv = reviews.get(st.id);
      const reviewLine = rv ? `\nReview by ${rv.reviewer}: ${rv.verdict} after ${rv.rounds} round(s)` : "";
      return `### ${st.title} (${role ? `${role.name}, ` : ""}${worker.label})${reviewLine}\n${clip(String(results.get(st.id) || ""), 2000)}`;
    })
    .join("\n\n");
  const caveats = reviews.size ? "any follow-ups or caveats (including review findings that remain open)" : "any follow-ups or caveats";
  const synthPrompt = `You orchestrated multiple AI workers on this task:\n"${task}"\n\nHere is what each worker produced:\n\n${summaryInput}\n\nWrite a concise final summary for the user: what was accomplished across the subtasks, any files changed, and ${caveats}. The reports above are your source, so answer from them without using tools.${conductorGuidance(orchestra)}`;

  log(`Zusammenfassung: ${conductor.worker.label}`);
  let synth = "";
  const synthErrors: string[] = [];
  try {
    const r = await runText(session, conductor.worker, synthPrompt, {
      signal,
      onChunk: (c) => { synth += c; emit({ type: "synthesis", content: c }); },
      onError: (m) => synthErrors.push(m),
      onLog: (m) => log(m),
    });
    costUsd += r.costUsd;
    if (r.isError && !synth.trim() && !synthErrors.length) synthErrors.push("kein Output");
  } catch (err) {
    synthErrors.push(err instanceof Error ? err.message : String(err));
  }
  if (synth.trim()) record({ role: "synthesis", content: synth.trim() });
  if (signal?.aborted) return stop();
  if (synthErrors.length) {
    const msg = `Zusammenfassung fehlgeschlagen: ${synthErrors[0]}`;
    emit({ type: "error", content: msg });
    record({ role: "error", content: msg.slice(0, 4000) });
  }

  return { costUsd, isError, stopped: false };
}

/** Auto mode: plan + execute in one shot. */
export async function orchestrate(
  session: AssistantSessionRow,
  task: string,
  io: OrchestrationIO,
  opts: OrchestrationOptions = {}
): Promise<OrchestrationResult> {
  const log = (content: string) => io.emit({ type: "log", content });
  let subtasks: PlannedSubtask[];
  let planCost = 0;
  try {
    const workers = await discoverWorkers(opts.clientProviders);
    if (!workers.length) throw new Error(NO_WORKER_MSG);
    ({ subtasks, costUsd: planCost } = await plan(session, task, workers, { ...opts, signal: io.signal, onLog: log }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Planung fehlgeschlagen";
    io.emit({ type: "error", content: msg });
    io.record?.({ role: "error", content: msg.slice(0, 4000) });
    return { costUsd: 0, isError: true, stopped: false };
  }
  if (io.signal?.aborted) {
    log(STOPPED_MSG);
    return { costUsd: planCost, isError: false, stopped: true };
  }
  const res = await executePlan(session, task, subtasks, io, opts);
  return { ...res, costUsd: res.costUsd + planCost };
}

/**
 * Runs an orchestration as the work of a hub run (see session-run.launchRun):
 * events are published into the run, rows go through the run's ordered
 * transcript writer, Stop aborts via the run's signal, and the CLI cost is
 * added to the session. Pass `subtasks` to execute an edited (hybrid) plan.
 */
export async function orchestrateRun(
  ctx: RunContext,
  session: AssistantSessionRow,
  task: string,
  opts: OrchestrationOptions & { subtasks?: PlannedSubtask[] } = {}
): Promise<RunOutcome> {
  const io: OrchestrationIO = {
    emit: (e) => ctx.publish(e as unknown as HubEvent),
    record: (row) => ctx.writer.add(row),
    signal: ctx.signal,
  };
  const res = opts.subtasks?.length
    ? await executePlan(session, task, opts.subtasks, io, opts)
    : await orchestrate(session, task, io, opts);
  if (res.costUsd > 0) {
    await prisma.assistantSession
      .update({ where: { id: ctx.sessionId }, data: { totalCostUsd: { increment: res.costUsd } } })
      .catch((err) => console.error("[orchestrate] cost bookkeeping failed", err));
  }
  return { isError: res.isError };
}
