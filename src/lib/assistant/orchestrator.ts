import { promises as fs, constants as fsConstants } from "fs";
import path from "path";
import os from "node:os";
import { prisma } from "@/lib/db/client";
import { runTurn, type AssistantSessionRow } from "./runner";
import type { HubEvent } from "./run-hub";
import type { RunContext, RunOutcome } from "./session-run";
import type { TranscriptRow } from "./transcript";
import { fetchOllamaModels } from "@/lib/ai/ollama-provider";
import { createProvider } from "@/lib/ai/provider-factory";
import { getProvider } from "@/lib/ai/catalog";
import { fetchOpenAICompatModels } from "@/lib/ai/openai-compatible-provider";
import type { AIProvider, ModelInfo } from "@/lib/ai/types";

// A configured OpenAI-compatible provider passed from the client (key/base URL
// live in the browser). Offered to the planner as an optional text worker.
export interface ClientProvider {
  id: string;
  key?: string;
  baseUrl?: string;
}

// A worker is a concrete model the orchestrator can route a subtask to.
export interface Worker {
  id: string;
  kind: "claude-cli" | "gemini-cli" | "ollama" | "api";
  model: string;
  label: string;
  strengths: string;
  editsFiles: boolean;
  providerId?: string; // for kind "api" — catalog id
  apiKey?: string; // for kind "api"
  baseUrl?: string; // for kind "api" (custom endpoint)
}

// Published into the session's run as-is (see run-hub). `synthesis` carries an
// incremental chunk — clients append.
export interface OrchEvent {
  type: "plan" | "subtask_start" | "subtask_text" | "subtask_end" | "synthesis" | "error" | "log";
  content?: string;
  subtaskId?: string;
  title?: string;
  workerId?: string;
  workerLabel?: string;
  subtasks?: PlannedSubtask[];
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
}

export interface OrchestrationOptions {
  preference?: string;
  clientProviders?: ClientProvider[];
  /** "" / "auto" = Auto; otherwise a worker id that plans and synthesizes. */
  plannerWorkerId?: string;
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
}

// Discovery (PATH probes, gemini creds, Ollama /api/tags) is shared by the
// workers dropdown, planning and execution — memoize it briefly so one
// orchestration doesn't repeat it. Client providers are cheap (no I/O) and are
// rebuilt on every call, so keys/base URLs are never stale. Kept on globalThis
// so every route's module graph shares one cache per process.
const POOL_TTL_MS = 30_000;
const API_MODEL_TTL_MS = 5 * 60_000;
// An unreachable Ollama host (e.g. an offline tailnet machine) must not stall
// discovery — and with it a run that Stop cannot interrupt yet.
const OLLAMA_DISCOVERY_TIMEOUT_MS = 8_000;

interface OrchCaches {
  pool: { at: number; pool: Promise<LocalPool> } | null;
  apiModels: Map<string, { at: number; model: Promise<string> }>;
}
const gc = globalThis as unknown as { __cmOrchCaches?: OrchCaches };
const caches: OrchCaches = (gc.__cmOrchCaches ??= { pool: null, apiModels: new Map() });

function localPool(): Promise<LocalPool> {
  const now = Date.now();
  if (caches.pool && now - caches.pool.at < POOL_TTL_MS) return caches.pool.pool;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ollamaTimeout = new Promise<ModelInfo[]>((resolve) => {
    timer = setTimeout(() => resolve([]), OLLAMA_DISCOVERY_TIMEOUT_MS);
    timer.unref?.();
  });
  const pool = Promise.all([
    onPath("claude"),
    geminiAvailable(),
    Promise.race([fetchOllamaModels().catch(() => [] as ModelInfo[]), ollamaTimeout]).finally(() => clearTimeout(timer)),
  ]).then(([claude, gemini, ollama]) => ({ claude, gemini, ollama }));
  caches.pool = { at: now, pool };
  return pool;
}

// --- Model classification -------------------------------------------------------

const CODER_MODEL = /coder|codestral|devstral|codellama|codegemma|starcoder/i;
const NON_GENERAL_LOCAL = /embed|bge|rerank|guard|whisper|tts/i;
// Strong general local models, best first. Installed models from this list win;
// otherwise the largest remaining general model (by parameter count) is used.
// An exact tag match beats a prefix match, so "qwen3.8:27b" is picked over the
// heavier "qwen3.8:27b-q8_0" quant that would spill out of VRAM.
const GENERAL_PRIORITY = [
  "qwen3.8:27b", "qwen3.6:35b", "gemma4:31b", "nemotron3", "nemotron-cascade",
  "qwen3.6:27b", "mistral-small3.2", "glm-4.7-flash", "gemma4:26b", "gemma4:12b", "phi4",
];

/** Parameter count in billions from Ollama's "(35B)" name suffix or a ":35b" tag. */
function paramBillions(m: { id: string; name?: string }): number {
  const fromName = m.name?.match(/\((\d+(?:\.\d+)?)\s*([BM])\)\s*$/i);
  if (fromName) return Number(fromName[1]) / (fromName[2].toUpperCase() === "M" ? 1000 : 1);
  const fromId = m.id.match(/(\d+(?:\.\d+)?)b\b/i);
  return fromId ? Number(fromId[1]) : 0;
}

function isGeneralLocal(id: string): boolean {
  return !CODER_MODEL.test(id) && !NON_GENERAL_LOCAL.test(id);
}

/** The strongest general (non-coder, non-embedding) local model, if any. */
function strongestGeneral<T extends { id: string; name?: string }>(models: T[]): T | undefined {
  const prio = (id: string) => {
    const exact = GENERAL_PRIORITY.indexOf(id);
    if (exact >= 0) return exact;
    const i = GENERAL_PRIORITY.findIndex((p) => id.startsWith(p));
    return i < 0 ? GENERAL_PRIORITY.length : i + 0.5;
  };
  return models
    .filter((m) => isGeneralLocal(m.id))
    .sort((a, b) => prio(a.id) - prio(b.id) || paramBillions(b) - paramBillions(a) || a.id.localeCompare(b.id))[0];
}

// --- Workers --------------------------------------------------------------------

function claudeWorker(): Worker {
  return {
    id: "claude",
    kind: "claude-cli",
    model: "",
    label: "Claude Code",
    strengths: "Strongest at complex reasoning, software architecture, multi-file refactors, careful debugging and agentic file edits. Best for the hardest or most safety-critical coding subtasks. Higher cost.",
    editsFiles: true,
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
      providerId: def.id,
      apiKey: cp.key || "",
      baseUrl,
    });
  }
  return out;
}

/**
 * The curated pool the planner routes to, with a strengths profile per worker:
 * the installed file-editing CLIs, a local coder + the strongest general local
 * Ollama model (text-only), and the user's configured cloud/custom APIs.
 */
export async function discoverWorkers(clientProviders: ClientProvider[] = []): Promise<Worker[]> {
  const pool = await localPool();
  const workers: Worker[] = [];
  if (pool.claude) workers.push(claudeWorker());
  if (pool.gemini) workers.push(geminiWorker());
  const coder = pool.ollama.find((m) => CODER_MODEL.test(m.id));
  const general = strongestGeneral(pool.ollama);
  for (const m of [coder, general]) if (m) workers.push(ollamaWorker(m.id));
  workers.push(...buildApiWorkers(clientProviders));
  return workers;
}

/**
 * The full worker pool for the hybrid editor: the curated pool plus EVERY
 * installed Ollama chat model, so the user can manually route a subtask to any
 * local model (e.g. gemma4:31b).
 */
export async function discoverAllWorkers(clientProviders: ClientProvider[] = []): Promise<Worker[]> {
  const [curated, pool] = await Promise.all([discoverWorkers(clientProviders), localPool()]);
  const out = curated.filter((w) => w.kind !== "ollama");
  const ids = new Set(out.map((w) => w.id));
  for (const m of pool.ollama) {
    const w = ollamaWorker(m.id);
    if (!ids.has(w.id)) { ids.add(w.id); out.push(w); }
  }
  return out;
}

// Resolve a worker id against a pool, building an Ollama worker on the fly for
// any ollama:<model> id (so manually-assigned local models always run).
function findWorker(workers: Worker[], id: string): Worker | null {
  const found = workers.find((w) => w.id === id);
  if (found) return found;
  if (id.startsWith("ollama:") && id.length > "ollama:".length) return ollamaWorker(id.slice("ollama:".length));
  return null;
}

// The approval gate and the sandbox are enforced through Claude Code settings
// (PreToolUse hook / sandbox). gemini-cli has neither, so while either is on in
// this session a Gemini worker runs read-only instead of bypassing them.
function geminiRestricted(session: AssistantSessionRow): boolean {
  return (!!session.approvalMode && session.approvalMode !== "off") || !!session.sandbox;
}

/** Whether a worker may change files in this session (a gated Gemini may not). */
export function canEditFiles(w: Worker, session: AssistantSessionRow): boolean {
  return w.kind === "claude-cli" || (w.kind === "gemini-cli" && !geminiRestricted(session));
}

function bestEditor(workers: Worker[], session: AssistantSessionRow): Worker | null {
  return workers.find((w) => w.kind === "claude-cli")
    ?? workers.find((w) => w.kind === "gemini-cli" && canEditFiles(w, session))
    ?? null;
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
  const assigned = subtasks.map((raw, i): Assignment => {
    const title = raw.title.trim() || `Teilaufgabe ${i + 1}`;
    let worker = findWorker(workers, raw.workerId);
    if (!worker) {
      worker = editor ?? workers[0] ?? null;
      if (!worker) throw new Error(NO_WORKER_MSG);
      notes.push(`Worker „${raw.workerId}“ ist nicht verfügbar — „${title}“ übernimmt ${worker.label}.`);
    }
    if (raw.editsFiles && !canEditFiles(worker, session)) {
      if (editor) {
        notes.push(`„${title}“ ändert Dateien, ${worker.label} kann das nicht — übernimmt ${editor.label}.`);
        worker = editor;
      } else {
        notes.push(`⚠ „${title}“ soll Dateien ändern, aber kein Worker mit Dateizugriff ist verfügbar — ${worker.label} liefert nur Text, es werden keine Dateien geändert.`);
      }
    }
    return { st: { ...raw, title, workerId: worker.id }, worker };
  });
  if (geminiRestricted(session) && assigned.some((a) => a.worker.kind === "gemini-cli")) {
    notes.push("Gemini CLI läuft schreibgeschützt: Freigabe-Modus bzw. Sandbox lassen sich für Gemini nicht erzwingen.");
  }
  return { assigned, notes };
}

// Which worker plans / synthesizes. An explicit id from the UI wins; otherwise
// Auto takes the strongest AVAILABLE model: Claude CLI > Gemini CLI > strongest
// general local Ollama model > a configured cloud API > anything left.
function resolvePlanner(workers: Worker[], plannerWorkerId?: string): { worker: Worker; note: string } | null {
  const id = (plannerWorkerId || "").trim();
  let prefix = "";
  if (id && id !== "auto") {
    const found = findWorker(workers, id);
    if (found) return { worker: found, note: `Planer: ${found.label}` };
    prefix = `Planer „${id}“ ist nicht verfügbar — `;
  }
  const generalLocal = strongestGeneral(
    workers.filter((w) => w.kind === "ollama").map((w) => ({ id: w.model, worker: w }))
  )?.worker;
  const worker =
    workers.find((w) => w.kind === "claude-cli") ??
    workers.find((w) => w.kind === "gemini-cli") ??
    generalLocal ??
    workers.find((w) => w.kind === "api") ??
    workers[0];
  return worker ? { worker, note: `${prefix}Planer (Auto): ${worker.label}` } : null;
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

// Tools a read-only Gemini worker may keep pre-approved.
const READ_ONLY_TOOLS = new Set(["Read", "Grep", "Glob", "WebSearch", "WebFetch"]);

/**
 * Runs a CLI worker. "work" = a real subtask with the session's permission
 * mode, tools, approval gate and sandbox (approval cards reach the UI through
 * the run hub). "text" = planning/synthesis: tool-less, read-only, no gate.
 */
async function runCli(
  session: AssistantSessionRow,
  worker: Worker,
  prompt: string,
  mode: "work" | "text",
  o: StreamOpts
): Promise<TextResult> {
  const gemini = worker.kind === "gemini-cli";
  const readOnlyGemini = gemini && mode === "work" && geminiRestricted(session);
  const row: AssistantSessionRow = {
    id: session.id, // same key as the run, so Stop kills this child too
    externalId: null, // fresh run; subtasks coordinate via the shared filesystem
    provider: gemini ? "gemini" : "claude",
    model: worker.model,
    cwd: session.cwd,
    ...(mode === "text"
      ? { permissionMode: "plan", allowedTools: "" }
      : {
          // gemini-cli's --allowed-tools skip confirmation, so a read-only
          // Gemini keeps only read tools; "default" denies the rest headless.
          permissionMode: readOnlyGemini ? "default" : session.permissionMode,
          allowedTools: readOnlyGemini
            ? session.allowedTools.split(",").map((t) => t.trim()).filter((t) => READ_ONLY_TOOLS.has(t)).join(",")
            : session.allowedTools,
          approvalMode: session.approvalMode,
          sandbox: session.sandbox,
          interactive: false,
        }),
  };
  let text = "";
  let reported = false;
  let failedResult = "";
  const res = await runTurn(row, prompt, undefined, (e) => {
    if (e.type === "text" && e.content) {
      // Each CLI text event is a whole message block — keep blocks apart.
      const piece = text && !text.endsWith("\n") ? `\n\n${e.content}` : e.content;
      text += piece;
      o.onChunk?.(piece);
    } else if (e.type === "error" && e.content) {
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
const LIMITS = { subtasks: 20, id: 50, title: 300, description: 20_000, workerId: 120, dependsOn: 20 };

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

async function plan(
  session: AssistantSessionRow,
  task: string,
  workers: Worker[],
  opts: PlanOptions
): Promise<{ subtasks: PlannedSubtask[]; costUsd: number }> {
  const profile = workers
    .map((w) => {
      const readOnly = w.kind === "gemini-cli" && !canEditFiles(w, session);
      return `- ${w.id} (${w.label}, editsFiles=${canEditFiles(w, session)}): ${w.strengths}${readOnly ? " (Read-only in this session.)" : ""}`;
    })
    .join("\n");

  const preference = opts.preference?.trim();
  const prefLine = preference
    ? `\nRouting preference from the user (honor it where quality allows): ${preference}\n`
    : "";

  const plannerPrompt = `You are an orchestration planner for a coding assistant working in the directory ${session.cwd}.${prefLine}
Decide the plan from the task text ALONE. Do NOT use any tools, do NOT read files, do NOT explore the codebase, and do NOT narrate. Your ENTIRE response must be a single JSON object and nothing else — no preamble, no explanation, no markdown fences.

Decompose the user's task into the MINIMUM set of subtasks and assign each to the single best worker, matching the subtask to the worker's strengths.

Available workers:
${profile}

Rules:
- For a simple question, status check, or single action, return EXACTLY ONE subtask assigned to a file-capable worker (claude or gemini) — that worker will do the actual reading/answering.
- Otherwise use 2-5 subtasks.
- Any subtask that creates/modifies/deletes files MUST use a worker with editsFiles=true (claude or gemini).
- Non-file-editing workers (editsFiles=false — local Ollama models and "api:" cloud text models) are OPTIONAL helpers: use them only for analysis, drafting snippets, or reviewing other workers' output — never for applying file changes or tasks needing to read the project. It is fine to not use them at all.
- Prefer claude for the hardest reasoning/architecture; gemini for broad/large-context sweeps; local/api text models for cheap isolated work.
- Order subtasks with dependsOn (array of subtask ids that must finish first). Independent subtasks may have an empty dependsOn.

Respond with ONLY this JSON shape:
{"subtasks":[{"id":"s1","title":"...","description":"<clear, self-contained instruction for the worker>","workerId":"<one of the worker ids>","dependsOn":[],"editsFiles":true|false}]}

Task:
${task}`;

  // Fallback: if the planner narrated instead of returning JSON (common for
  // simple questions), don't fail — run the whole task as a single subtask on a
  // file-capable worker, which can read the project and answer/act.
  const fallback = (): PlannedSubtask[] => {
    const w = bestEditor(workers, session) ?? workers[0];
    return [{ id: "s1", title: "Aufgabe bearbeiten", description: task, workerId: w.id, dependsOn: [], editsFiles: canEditFiles(w, session) }];
  };

  const choice = resolvePlanner(workers, opts.plannerWorkerId);
  if (!choice) throw new Error(NO_WORKER_MSG);
  opts.onLog?.(choice.note);

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
  const subtasks = list.map((s, i): PlannedSubtask => ({
    id: str(s.id, LIMITS.id) || `s${i + 1}`,
    title: str(s.title, LIMITS.title) || `Teilaufgabe ${i + 1}`,
    description: str(s.description, LIMITS.description),
    workerId: str(s.workerId, LIMITS.workerId),
    dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn.slice(0, LIMITS.dependsOn).map((d) => str(d, LIMITS.id)) : [],
    editsFiles: !!s.editsFiles,
  }));
  return { subtasks: subtasks.length === 0 ? fallback() : subtasks, costUsd };
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
  const { assigned } = assignWorkers(orderSubtasks(planned.subtasks), workers, session);
  // The single-subtask fallback carries the whole task; keep it within the
  // run schema so the edited plan can be submitted.
  const subtasks = assigned.map((a) => ({ ...a.st, description: a.st.description.slice(0, LIMITS.description) }));
  return { workers, subtasks, costUsd: planned.costUsd };
}

// --- Execution ------------------------------------------------------------------

/**
 * Executes a plan: subtasks run sequentially in dependency order (sharing the
 * working directory), then the planner model writes a streamed summary. Emits
 * live events, persists transcript rows in order, and stops cleanly (no
 * further subtasks, no synthesis) once `io.signal` aborts.
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
  const planned = assigned.map((a) => a.st);
  emit({ type: "plan", subtasks: planned });
  record({ role: "plan", content: task, meta: JSON.stringify({ subtasks: planned, workers: workers.map((w) => ({ id: w.id, label: w.label })) }) });
  for (const n of notes) log(n, true);

  const results = new Map<string, string>();

  for (const { st, worker } of assigned) {
    if (signal?.aborted) return stop();
    emit({ type: "subtask_start", subtaskId: st.id, title: st.title, workerId: worker.id, workerLabel: worker.label });

    // Provide upstream results as context (file edits are already on disk for CLIs,
    // but a text summary helps both CLI and local workers stay aligned).
    const deps = st.dependsOn.map((d) => results.get(d)).filter(Boolean);
    const context = deps.length
      ? `\n\nContext from previous subtasks:\n${deps.map((c, i) => `[${i + 1}] ${String(c).slice(0, 1500)}`).join("\n")}`
      : "";
    const prompt = `${st.description.trim() || st.title}${context}\n\n(You are working in ${session.cwd}.)`;

    const errors: string[] = [];
    const fail = (msg: string) => {
      if (signal?.aborted) return; // the stop itself is reported once
      errors.push(msg);
      emit({ type: "error", content: msg, subtaskId: st.id });
    };
    // Collected from the live chunks, so partial output survives a failed or
    // stopped stream and is persisted exactly as the UI showed it.
    let text = "";
    const stream: StreamOpts = {
      signal,
      onChunk: (c) => {
        text += c;
        emit({ type: "subtask_text", subtaskId: st.id, content: c });
      },
      onError: fail,
      onLog: (m) => log(m),
    };

    try {
      if (worker.kind === "ollama" || worker.kind === "api") {
        await runChat(worker, prompt, stream);
      } else {
        const r = await runCli(session, worker, prompt, "work", stream);
        costUsd += r.costUsd;
        if (r.isError && !signal?.aborted) isError = true;
      }
    } catch (err) {
      fail(`${worker.label} fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (errors.length) isError = true;

    results.set(st.id, text);
    if (text.trim() || (!errors.length && !signal?.aborted)) {
      record({
        role: "assistant",
        content: text.trim() || "(kein Output)",
        meta: JSON.stringify({ subtaskId: st.id, title: st.title, worker: worker.label, workerId: worker.id }),
      });
    }
    for (const e of errors) record({ role: "error", content: e.slice(0, 4000), meta: JSON.stringify({ subtaskId: st.id }) });
    emit({ type: "subtask_end", subtaskId: st.id, workerLabel: worker.label });
  }

  if (signal?.aborted) return stop();

  // Synthesis: a concise wrap-up of what the workers produced, streamed on the
  // planner model (or Auto) — not hardwired to Claude.
  const synthesizer = resolvePlanner(workers, opts.plannerWorkerId);
  if (!synthesizer) {
    log("Keine Zusammenfassung: kein Modell verfügbar.");
    return { costUsd, isError, stopped: false };
  }
  const summaryInput = assigned
    .map(({ st, worker }) => `### ${st.title} (${worker.label})\n${String(results.get(st.id) || "").slice(0, 2000)}`)
    .join("\n\n");
  const synthPrompt = `You orchestrated multiple AI workers on this task:\n"${task}"\n\nHere is what each worker produced:\n\n${summaryInput}\n\nWrite a concise final summary for the user: what was accomplished across the subtasks, any files changed, and any follow-ups or caveats. Do not use any tools.`;

  log(`Zusammenfassung: ${synthesizer.worker.label}`);
  let synth = "";
  const synthErrors: string[] = [];
  try {
    const r = await runText(session, synthesizer.worker, synthPrompt, {
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
