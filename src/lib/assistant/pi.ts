import { execFile } from "child_process";
import { randomBytes } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import type { NormalizedEvent } from "./runner";

// pi coding agent (https://pi.dev, npm @earendil-works/pi-coding-agent) as a
// file-editing agent for every local Ollama model. CodeMaestro keeps its own pi
// agent dir (models.json generated from Ollama, settings.json, sessions) so the
// user's ~/.pi is never read or written.

export const PI_INSTALL_HINT = "npm install -g --ignore-scripts @earendil-works/pi-coding-agent";

/** The pi binary: PI_BIN or "pi" on PATH. */
export function piBin(): string {
  return process.env.PI_BIN?.trim() || "pi";
}

/** <cwd>/.codemaestro/pi-agent (git-ignored); CODEMAESTRO_PI_AGENT_DIR overrides. */
export function piAgentDir(): string {
  return process.env.CODEMAESTRO_PI_AGENT_DIR?.trim() || path.join(process.cwd(), ".codemaestro", "pi-agent");
}

export function piSessionsDir(): string {
  return path.join(piAgentDir(), "sessions");
}

/** Ollama's native API root (OLLAMA_BASE_URL without a trailing /v1). */
export function ollamaBaseUrl(): string {
  return (process.env.OLLAMA_BASE_URL?.trim() || "http://localhost:11434").replace(/\/+$/, "").replace(/\/v1$/, "");
}

/** Env for every pi process: our agent dir, no update checks/telemetry. */
export function piEnv(): Record<string, string> {
  return { PI_CODING_AGENT_DIR: piAgentDir(), PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0" };
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
}

/** Writes via tmp file + rename so pi never reads a half-written file. Skips unchanged content. */
async function writeAtomic(file: string, content: string): Promise<void> {
  try {
    if ((await fs.readFile(file, "utf8")) === content) return;
  } catch { /* missing → write */ }
  await ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    await fs.writeFile(tmp, content, { mode: 0o600 });
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

// --- Binary / version --------------------------------------------------------

export interface PiInfo {
  installed: boolean;
  version: string | null;
  bin: string;
  error?: string;
}

// Process-wide (route handlers and the runner live in different module graphs).
interface PiCaches {
  version: { bin: string; at: number; info: Promise<PiInfo> } | null;
  sync: { at: number; result: PiSyncResult } | null;
  inflight: Promise<PiSyncResult> | null;
  lastGood: PiModel[] | null;
  shows: Map<string, OllamaShow>;
}
const gp = globalThis as unknown as { __cmPi?: PiCaches };
const caches: PiCaches = (gp.__cmPi ??= { version: null, sync: null, inflight: null, lastGood: null, shows: new Map() });

const VERSION_TTL_MS = 10 * 60_000;
const VERSION_FAIL_TTL_MS = 30_000; // pi may get installed while the server runs

/** `pi --version` (cached). Never throws. */
export function piInfo(opts: { force?: boolean } = {}): Promise<PiInfo> {
  const bin = piBin();
  const c = caches.version;
  if (!opts.force && c && c.bin === bin) {
    const age = Date.now() - c.at;
    if (age < VERSION_FAIL_TTL_MS) return c.info;
    if (age < VERSION_TTL_MS) {
      return c.info.then((i) => (i.installed ? i : piInfo({ force: true })));
    }
  }
  const info = new Promise<PiInfo>((resolve) => {
    execFile(bin, ["--version"], { timeout: 15_000, env: { ...process.env, ...piEnv() } }, (err, stdout, stderr) => {
      if (err) {
        const enoent = (err as NodeJS.ErrnoException).code === "ENOENT";
        resolve({
          installed: false,
          version: null,
          bin,
          error: enoent ? `${bin} nicht gefunden` : (String(stderr).trim() || err.message).slice(0, 500),
        });
        return;
      }
      const m = /\d+\.\d+\.\d+[\w.+-]*/.exec(String(stdout));
      resolve({ installed: true, version: m ? m[0] : String(stdout).trim() || null, bin });
    });
  });
  caches.version = { bin, at: Date.now(), info };
  return info;
}

// --- Settings ------------------------------------------------------------------

/** Per-model compaction budget that fits small local context windows. */
function compactionFor(contextWindow: number): { reserveTokens: number; keepRecentTokens: number } {
  const quarter = Math.floor(contextWindow / 4);
  return {
    reserveTokens: Math.max(1024, Math.min(16_384, quarter)),
    keepRecentTokens: Math.max(1024, Math.min(20_000, quarter)),
  };
}

/** The settings CodeMaestro enforces in its pi agent dir. */
export function buildPiSettings(models: PiModel[] = []): Record<string, unknown> {
  const modelOverrides: Record<string, unknown> = {};
  for (const m of models) modelOverrides[`ollama/${m.id}`] = compactionFor(m.contextWindow);
  return {
    // Slow local prefill can exceed pi's 5 min default.
    httpIdleTimeoutMs: 900_000,
    // Never execute a repository's own .pi/ extensions or settings.
    defaultProjectTrust: "never",
    retry: { maxRetries: 2 },
    compaction: { reserveTokens: 8192, keepRecentTokens: 8000, modelOverrides },
    enableInstallTelemetry: false,
    quietStartup: true,
  };
}

/**
 * Writes settings.json (managed keys win; unknown keys a user added are kept).
 * `models` refreshes the per-model compaction overrides; without it the
 * current overrides stay.
 */
export async function ensureSettings(models?: PiModel[]): Promise<void> {
  const file = path.join(piAgentDir(), "settings.json");
  let current: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) current = parsed;
  } catch { /* missing or invalid → rewrite */ }
  const managed = buildPiSettings(models ?? caches.lastGood ?? []);
  if (!models && !caches.lastGood) {
    const prev = (current.compaction as { modelOverrides?: unknown } | undefined)?.modelOverrides;
    if (prev && typeof prev === "object") (managed.compaction as Record<string, unknown>).modelOverrides = prev;
  }
  await ensureDir(piSessionsDir());
  await writeAtomic(file, JSON.stringify({ ...current, ...managed }, null, 2) + "\n");
}

// --- Ollama model sync -------------------------------------------------------------

export interface PiModel {
  id: string;
  name: string;
  /** Model supports tool calls (file editing). Others run with --no-tools. */
  toolsOk: boolean;
  reasoning: boolean;
  vision: boolean;
  /** Effective runtime context (what Ollama allocates, not the trained maximum). */
  contextWindow: number;
}

export interface PiSyncResult {
  models: PiModel[];
  /** Set when Ollama could not be reached; `models` is then the last good list. */
  error?: string;
  syncedAt: number | null;
  ollamaBaseUrl: string;
  /** Runtime context assumed for models without a num_ctx parameter. */
  contextFallback: number;
}

export interface OllamaShow {
  capabilities?: string[];
  model_info?: Record<string, unknown>;
  parameters?: string;
  details?: { family?: string; parameter_size?: string };
}

interface OllamaTag {
  name?: string;
  model?: string;
  digest?: string;
  details?: { family?: string; parameter_size?: string };
}

const SYNC_TTL_MS = 60_000;
const SYNC_FAIL_TTL_MS = 15_000;
const TAGS_TIMEOUT_MS = 5_000;
const SHOW_TIMEOUT_MS = 8_000;
const SHOW_CONCURRENCY = 4;
// Ollama allocates 4k/32k/256k by VRAM unless OLLAMA_CONTEXT_LENGTH or a
// Modelfile num_ctx says otherwise — 32k is the common GPU-server case.
const DEFAULT_CONTEXT = 32_768;
const SAFE_THINKING_MAP = { off: "none", minimal: "low", xhigh: "high", max: "high" };

function envInt(name: string): number | undefined {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

/**
 * Context Ollama allocates when a model has no num_ctx parameter:
 * PI_OLLAMA_CONTEXT_LENGTH (the Ollama server's setting, for when CodeMaestro
 * runs elsewhere) > OLLAMA_CONTEXT_LENGTH > 32768.
 */
export function contextFallback(): number {
  return envInt("PI_OLLAMA_CONTEXT_LENGTH") ?? envInt("OLLAMA_CONTEXT_LENGTH") ?? DEFAULT_CONTEXT;
}

function numParam(parameters: string | undefined, key: string): number | undefined {
  const m = new RegExp(`(?:^|\\n)\\s*${key}\\s+(-?[\\d.]+)`).exec(parameters ?? "");
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function looksLikeEmbedding(id: string, show: OllamaShow, tag?: OllamaTag): boolean {
  const caps = show.capabilities;
  if (caps?.length) return caps.includes("embedding") && !caps.includes("completion");
  const family = show.details?.family ?? tag?.details?.family;
  return family === "bert" || family === "nomic-bert" || /(^|[/_-])(embed|bge)/i.test(id);
}

/** Effective runtime context: min(num_ctx ?? server fallback, trained maximum). */
export function effectiveContext(show: OllamaShow, fallback = contextFallback()): number {
  const info = show.model_info ?? {};
  const arch = info["general.architecture"];
  const trained = Number(typeof arch === "string" ? info[`${arch}.context_length`] : NaN);
  const numCtx = numParam(show.parameters, "num_ctx");
  const runtime = numCtx && numCtx > 0 ? Math.floor(numCtx) : fallback;
  const ctx = Number.isFinite(trained) && trained > 0 ? Math.min(runtime, trained) : runtime;
  return Math.max(1024, ctx);
}

/** Maps Ollama /api/show metadata onto a pi model (null = not a chat model). */
export function modelFromShow(id: string, show: OllamaShow, fallback = contextFallback(), tag?: OllamaTag): PiModel | null {
  if (looksLikeEmbedding(id, show, tag)) return null;
  const caps = show.capabilities ?? [];
  // Unknown capabilities (old Ollama / failed show) → assume tools work.
  const toolsOk = caps.length === 0 || caps.includes("tools");
  const size = show.details?.parameter_size ?? tag?.details?.parameter_size;
  return {
    id,
    name: size ? `${id} (${size})` : id,
    toolsOk,
    reasoning: caps.includes("thinking"),
    vision: caps.includes("vision"),
    contextWindow: effectiveContext(show, fallback),
  };
}

/** pi models.json for the given models (provider "ollama", OpenAI-compatible API). */
export function buildModelsJson(
  models: PiModel[],
  baseUrl = ollamaBaseUrl(),
  sampling: Map<string, Record<string, number>> = new Map()
): Record<string, unknown> {
  return {
    providers: {
      ollama: {
        baseUrl: `${baseUrl}/v1`,
        api: "openai-completions",
        apiKey: "ollama",
        // Ollama: roles pass through (no "developer"), no `store`, and only
        // `max_tokens` maps to num_predict.
        compat: { supportsDeveloperRole: false, supportsStore: false, maxTokensField: "max_tokens" },
        models: models.map((m) => ({
          id: m.id,
          name: m.name,
          reasoning: m.reasoning,
          ...(m.reasoning ? { thinkingLevelMap: SAFE_THINKING_MAP } : {}),
          input: m.vision ? ["text", "image"] : ["text"],
          contextWindow: m.contextWindow,
          maxTokens: Math.max(1024, Math.min(16_384, Math.floor(m.contextWindow / 4))),
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          // Ollama's OpenAI layer forces temperature/top_p to 1.0 when absent,
          // ignoring the Modelfile — pass the Modelfile values explicitly.
          ...(sampling.get(m.id) ? { samplingParams: sampling.get(m.id) } : {}),
        })),
      },
    },
  };
}

async function fetchJson<T>(url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const res = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function showModel(base: string, tag: OllamaTag, id: string): Promise<OllamaShow> {
  const key = `${base}|${id}|${tag.digest ?? ""}`;
  const hit = tag.digest ? caches.shows.get(key) : undefined;
  if (hit) return hit;
  try {
    const show = await fetchJson<OllamaShow>(`${base}/api/show`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: id }),
    }, SHOW_TIMEOUT_MS);
    if (tag.digest) caches.shows.set(key, show);
    return show;
  } catch {
    return {}; // unknown capabilities: registered with defaults
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const SIDECAR = "codemaestro-models.json";

async function readSidecar(): Promise<PiModel[] | null> {
  try {
    const data = JSON.parse(await fs.readFile(path.join(piAgentDir(), SIDECAR), "utf8")) as { models?: PiModel[] };
    return Array.isArray(data.models) ? data.models : null;
  } catch {
    return null;
  }
}

function errText(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  return err.name === "TimeoutError" ? "Zeitüberschreitung" : err.message;
}

async function doSync(): Promise<PiSyncResult> {
  const base = ollamaBaseUrl();
  const fallback = contextFallback();
  let list: OllamaTag[];
  let shows: OllamaShow[];
  try {
    const tags = await fetchJson<{ models?: OllamaTag[] }>(`${base}/api/tags`, {}, TAGS_TIMEOUT_MS);
    list = (tags.models ?? []).filter((t) => t.model || t.name);
    shows = await mapLimit(list, SHOW_CONCURRENCY, (t) => showModel(base, t, (t.model || t.name) as string));
  } catch (err) {
    // Never throw on an Ollama outage: keep the last good models.json and list.
    const last = caches.lastGood ?? (await readSidecar()) ?? [];
    if (!caches.lastGood && last.length) caches.lastGood = last;
    return {
      models: last,
      error: `Ollama nicht erreichbar (${base}): ${errText(err)}`,
      syncedAt: caches.sync?.result.syncedAt ?? null,
      ollamaBaseUrl: base,
      contextFallback: fallback,
    };
  }

  const models: PiModel[] = [];
  const sampling = new Map<string, Record<string, number>>();
  list.forEach((t, i) => {
    const id = (t.model || t.name) as string;
    const m = modelFromShow(id, shows[i], fallback, t);
    if (!m || models.some((x) => x.id === id)) return;
    models.push(m);
    const params: Record<string, number> = {};
    const temperature = numParam(shows[i].parameters, "temperature");
    const topP = numParam(shows[i].parameters, "top_p");
    if (temperature !== undefined) params.temperature = temperature;
    if (topP !== undefined) params.top_p = topP;
    if (Object.keys(params).length) sampling.set(id, params);
  });
  caches.lastGood = models;
  const syncedAt = Date.now();
  try {
    const dir = piAgentDir();
    await writeAtomic(path.join(dir, "models.json"), JSON.stringify(buildModelsJson(models, base, sampling), null, 2) + "\n");
    await writeAtomic(path.join(dir, SIDECAR), JSON.stringify({ syncedAt, ollamaBaseUrl: base, models }, null, 2) + "\n");
    await ensureSettings(models);
  } catch (err) {
    return { models, error: `pi-Konfiguration konnte nicht geschrieben werden: ${errText(err)}`, syncedAt, ollamaBaseUrl: base, contextFallback: fallback };
  }
  return { models, syncedAt, ollamaBaseUrl: base, contextFallback: fallback };
}

/**
 * Discovers every Ollama model (GET /api/tags + POST /api/show) and writes pi's
 * models.json. Cached ~60 s; concurrent callers share one sync. Never throws.
 *
 * `force` guarantees a sync that starts after the call (e.g. right after a
 * model was pulled): an in-flight sync may have listed /api/tags before that,
 * so a forced caller waits for it and then starts — or joins — a fresh one.
 */
export function syncOllamaModels(opts: { force?: boolean } = {}): Promise<PiSyncResult> {
  const c = caches.sync;
  if (!opts.force && c && c.result.ollamaBaseUrl === ollamaBaseUrl()) {
    const ttl = c.result.error ? SYNC_FAIL_TTL_MS : SYNC_TTL_MS;
    if (Date.now() - c.at < ttl) return Promise.resolve(c.result);
  }
  const running = caches.inflight;
  if (running && !opts.force) return running;
  if (running) {
    // Any sync in flight once `running` settled began after this call, so
    // several forced callers waiting here share a single fresh sync.
    return running.then(() => caches.inflight ?? startSync());
  }
  return startSync();
}

function startSync(): Promise<PiSyncResult> {
  const p: Promise<PiSyncResult> = doSync()
    .catch((err): PiSyncResult => ({
      models: caches.lastGood ?? [],
      error: err instanceof Error ? err.message : String(err),
      syncedAt: null,
      ollamaBaseUrl: ollamaBaseUrl(),
      contextFallback: contextFallback(),
    }))
    .then((result) => {
      caches.sync = { at: Date.now(), result };
      return result;
    })
    .finally(() => {
      if (caches.inflight === p) caches.inflight = null;
    });
  caches.inflight = p;
  return p;
}

/** Test hook: forget cached sync/version state. */
export function resetPiCaches(): void {
  caches.version = null;
  caches.sync = null;
  caches.inflight = null;
  caches.lastGood = null;
  caches.shows.clear();
}

// --- Tools -------------------------------------------------------------------------

// Claude-style tool names (what the UI offers) → pi built-in tools. pi cannot
// restrict bash to command patterns, so "Bash(git *)"/"Bash(gh *)" grant nothing.
const PI_TOOLS_FOR: Record<string, string[]> = {
  Read: ["read", "grep", "find", "ls"],
  Grep: ["grep"],
  Glob: ["find", "ls"],
  Bash: ["bash"],
  Edit: ["edit"],
  Write: ["write"],
};
const PI_MUTATING = new Set(["bash", "edit", "write"]);

/** pi --tools list for a session's allowedTools (plan mode keeps read-only tools). */
export function mapToolsForPi(csv: string, permissionMode = "default"): string[] {
  const out = new Set<string>();
  for (const t of csv.split(",").map((x) => x.trim()).filter(Boolean)) {
    // Own keys only: allowedTools is free text, and "constructor"/"toString"
    // would otherwise resolve to Object.prototype functions (not iterable).
    if (!Object.hasOwn(PI_TOOLS_FOR, t)) continue;
    for (const p of PI_TOOLS_FOR[t]) {
      if (permissionMode === "plan" && PI_MUTATING.has(p)) continue;
      out.add(p);
    }
  }
  return [...out];
}

/** pi tools the approval extension gates for an approval mode. */
export function piGatedTools(approvalMode: string | undefined): string[] {
  if (approvalMode === "all") return ["write", "edit", "bash"];
  if (approvalMode === "edits") return ["write", "edit"];
  return [];
}

const PI_DISPLAY_NAMES: Record<string, string> = {
  read: "Read", write: "Write", edit: "Edit", bash: "Bash", grep: "Grep", find: "Glob", ls: "LS",
};

export function piToolDisplayName(name: string): string {
  return Object.hasOwn(PI_DISPLAY_NAMES, name) ? PI_DISPLAY_NAMES[name] : name;
}

type PiEdit = { oldText?: unknown; newText?: unknown };

/** pi's edit argument normalization (edits[] / JSON string / single / legacy top-level). */
export function piEditList(args: Record<string, unknown>): PiEdit[] {
  let edits: unknown = args.edits;
  if (typeof edits === "string") {
    try { edits = JSON.parse(edits); } catch { /* keep */ }
  }
  const list: PiEdit[] = Array.isArray(edits)
    ? edits.filter((e) => e && typeof e === "object")
    : edits && typeof edits === "object" ? [edits as PiEdit] : [];
  if (typeof args.oldText === "string" && typeof args.newText === "string") {
    list.push({ oldText: args.oldText, newText: args.newText });
  }
  return list;
}

/** pi tool args → Claude-shaped input (file_path, old_string/new_string) for the UI. */
export function piToolInputForDisplay(name: string, args: unknown): unknown {
  if (!args || typeof args !== "object" || Array.isArray(args)) return args;
  const a = args as Record<string, unknown>;
  if (name === "edit") {
    const edits = piEditList(a).map((e) => ({ old_string: String(e.oldText ?? ""), new_string: String(e.newText ?? "") }));
    return edits.length === 1 ? { file_path: a.path, ...edits[0] } : { file_path: a.path, edits };
  }
  if (name === "read" || name === "write") {
    const { path: p, ...rest } = a;
    return { file_path: p, ...rest };
  }
  return a;
}

// --- JSON event stream -------------------------------------------------------------

/** A mapped pi event: a streamed delta (coalesced by the runner) or a whole event. */
export type PiMapped =
  | { kind: "delta"; type: "text" | "thinking"; content: string }
  | { kind: "event"; event: NormalizedEvent };

interface PiContentBlock {
  type?: string;
  text?: string;
  thinking?: string;
}

interface PiLine {
  type?: string;
  id?: string;
  message?: { role?: string; content?: unknown; stopReason?: string; errorMessage?: string };
  assistantMessageEvent?: { type?: string; delta?: string };
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  result?: { content?: unknown };
  isError?: boolean;
  willRetry?: boolean;
  success?: boolean;
  finalError?: string;
}

function blocksOf(content: unknown): PiContentBlock[] {
  return Array.isArray(content) ? content.filter((b): b is PiContentBlock => !!b && typeof b === "object") : [];
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  return blocksOf(content).filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text).join("");
}

/**
 * Maps pi `--mode json` records onto runner events. pi exits 0 even when the
 * provider failed, so errors are taken from the stream: an assistant message
 * ending in stopReason error/aborted (reported once retries are exhausted) and
 * a failed auto_retry_end.
 */
export class PiEventMapper {
  externalId: string | null = null;
  isError = false;
  /** agent_end / agent_settled seen (the run finished on its own). */
  sawEnd = false;
  private sawSession = false;
  private resultEmitted = false;
  private finalText = "";
  private pendingError: string | null = null;
  private errorEmitted = false;
  private streamedText = false;
  private streamedThinking = false;

  constructor(private readonly model: string) {}

  /** Parses one JSONL line (invalid lines are ignored). */
  handleLine(line: string): PiMapped[] {
    const trimmed = line.trim();
    if (!trimmed) return [];
    let obj: PiLine;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      return [];
    }
    return obj && typeof obj === "object" ? this.handle(obj) : [];
  }

  handle(obj: PiLine): PiMapped[] {
    const ev = (event: NormalizedEvent): PiMapped => ({ kind: "event", event });
    switch (obj.type) {
      case "session": {
        if (typeof obj.id !== "string") return [];
        this.sawSession = true;
        this.externalId = obj.id;
        return [ev({ type: "init", sessionId: obj.id, model: this.model })];
      }
      case "message_start":
        if (obj.message?.role === "assistant") {
          this.streamedText = false;
          this.streamedThinking = false;
        }
        return [];
      case "message_update": {
        const e = obj.assistantMessageEvent;
        if (e?.type === "text_delta" && e.delta) {
          this.streamedText = true;
          return [{ kind: "delta", type: "text", content: e.delta }];
        }
        if (e?.type === "thinking_delta" && e.delta) {
          this.streamedThinking = true;
          return [{ kind: "delta", type: "thinking", content: e.delta }];
        }
        return [];
      }
      case "message_end": {
        const m = obj.message;
        if (m?.role !== "assistant") return [];
        const out: PiMapped[] = [];
        // A message that arrived without deltas is emitted whole.
        for (const b of blocksOf(m.content)) {
          if (b.type === "thinking" && b.thinking && !this.streamedThinking) out.push(ev({ type: "thinking", content: b.thinking }));
          else if (b.type === "text" && b.text && !this.streamedText) out.push(ev({ type: "text", content: b.text }));
        }
        if (m.stopReason === "error" || m.stopReason === "aborted") {
          const msg = m.errorMessage?.trim();
          this.pendingError = m.stopReason === "aborted"
            ? `Abgebrochen.${msg ? ` ${msg}` : ""}`
            : `Modell-Anfrage fehlgeschlagen (ollama/${this.model}): ${msg || "unbekannter Fehler"}`;
        } else {
          this.pendingError = null;
          const text = textOf(m.content).trim();
          if (text) this.finalText = text;
        }
        return out;
      }
      case "tool_execution_start": {
        const name = obj.toolName ?? "tool";
        return [ev({ type: "tool_use", name: piToolDisplayName(name), input: piToolInputForDisplay(name, obj.args), toolUseId: obj.toolCallId })];
      }
      case "tool_execution_end": {
        const r = obj.result;
        const content = textOf(r?.content) || (r === undefined ? "" : JSON.stringify(r).slice(0, 8000));
        return [ev({ type: "tool_result", toolUseId: obj.toolCallId, content, isError: !!obj.isError })];
      }
      case "agent_end":
        this.sawEnd = true;
        // A failed attempt that pi retries is not the turn's outcome yet.
        if (!obj.willRetry && this.pendingError) return [ev(this.error(this.pendingError))];
        return [];
      case "auto_retry_end":
        // Usually already reported by the final agent_end; this covers the rest.
        if (obj.success === false && !this.errorEmitted) {
          return [ev(this.error(this.pendingError ?? `Modell-Anfrage fehlgeschlagen (ollama/${this.model}): ${obj.finalError || "unbekannter Fehler"}`))];
        }
        return [];
      case "agent_settled":
        this.sawEnd = true;
        return this.result();
      default:
        return [];
    }
  }

  /** Called when the process exits: reports what the stream left open. */
  finish(opts: { stopped: boolean }): PiMapped[] {
    if (opts.stopped) return [];
    const out: PiMapped[] = [];
    if (this.pendingError) out.push({ kind: "event", event: this.error(this.pendingError) });
    return [...out, ...this.result()];
  }

  /** Error for a run that ended without pi's end-of-run records. */
  incomplete(detail: string): PiMapped[] {
    return [{ kind: "event", event: this.error(detail || "pi wurde ohne Ergebnis beendet.") }];
  }

  private error(content: string): NormalizedEvent {
    this.isError = true;
    this.errorEmitted = true;
    this.pendingError = null;
    return { type: "error", content };
  }

  private result(): PiMapped[] {
    if (this.resultEmitted || !this.sawSession) return [];
    this.resultEmitted = true;
    return [{ kind: "event", event: { type: "result", content: this.finalText, costUsd: 0, isError: this.isError } }];
  }
}

// pi session ids: [A-Za-z0-9._-], starting and ending alphanumeric.
const PI_SESSION_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,198}[A-Za-z0-9])?$/;

/**
 * pi session id for a turn: resume the stored one, or start a new unique one
 * (externalId is unique in the DB, and parallel fresh-context workers of the
 * same session must not share a session file).
 */
export function piSessionIdFor(sessionId: string, externalId: string | null): string {
  if (externalId && PI_SESSION_ID.test(externalId)) return externalId;
  return `${mintedPrefix(sessionId) || "cm-s-"}${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
}

/** "cm-<sessionId>-": the start of every pi session id minted for a CodeMaestro session ("" when unusable). */
function mintedPrefix(sessionId: string): string {
  const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 80);
  return safe ? `cm-${safe}-` : "";
}

/** A session's model id as pi/Ollama know it (an "ollama/" prefix is accepted). */
export function piRequestedModel(model: string | null | undefined): string {
  return (model || "").trim().replace(/^ollama\//, "");
}

/** The synced model an id refers to; a bare "name" also matches Ollama's "name:latest". */
export function findPiModel<T extends { id: string }>(models: T[], id: string): T | undefined {
  if (!id) return undefined;
  return models.find((m) => m.id === id) ?? (id.includes(":") ? undefined : models.find((m) => m.id === `${id}:latest`));
}

// Ollama model names (e.g. "qwen2.5-coder:14b", "hf.co/org/Model-GGUF:Q4_K_M").
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/;

export function isValidPiModelId(id: string): boolean {
  return MODEL_ID.test(id);
}

/**
 * Removes pi's session transcripts of a CodeMaestro session: the session's own
 * conversation (its externalId) and every one-off worker run the orchestrator
 * minted for it ("cm-<sessionId>-…"). Files are named "<ISO-ts>_<piSessionId>.jsonl"
 * in the flat sessions dir. Best effort.
 */
export async function deletePiSessionFiles(externalId: string | null | undefined, sessionId: string): Promise<number> {
  const prefix = mintedPrefix(sessionId);
  const own = externalId && PI_SESSION_ID.test(externalId) ? `_${externalId}.jsonl` : null;
  if (!prefix && !own) return 0;
  const dir = piSessionsDir();
  let removed = 0;
  try {
    for (const name of await fs.readdir(dir)) {
      const minted = prefix && name.includes(`_${prefix}`) && name.endsWith(".jsonl");
      if (minted || (own && name.endsWith(own))) {
        await fs.unlink(path.join(dir, name)).catch(() => {});
        removed++;
      }
    }
  } catch {
    /* no sessions dir yet */
  }
  return removed;
}
