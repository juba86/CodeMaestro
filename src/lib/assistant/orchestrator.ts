import { promises as fs } from "fs";
import path from "path";
import os from "node:os";
import { runTurn, type AssistantSessionRow, type NormalizedEvent } from "./runner";
import { fetchOllamaModels } from "@/lib/ai/ollama-provider";
import { createProvider } from "@/lib/ai/provider-factory";
import { getProvider } from "@/lib/ai/catalog";
import { fetchOpenAICompatModels } from "@/lib/ai/openai-compatible-provider";

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

export interface OrchEvent {
  type: "plan" | "subtask_start" | "subtask_text" | "subtask_end" | "synthesis" | "error" | "done" | "log";
  content?: string;
  subtaskId?: string;
  title?: string;
  workerId?: string;
  workerLabel?: string;
  costUsd?: number;
  isError?: boolean;
  subtasks?: PlannedSubtask[];
}

export interface PlannedSubtask {
  id: string;
  title: string;
  description: string;
  workerId: string;
  dependsOn: string[];
  editsFiles: boolean;
}

async function geminiAvailable(): Promise<boolean> {
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) return true;
  const home = os.homedir();
  try {
    await fs.access(path.join(home, ".gemini", "oauth_creds.json"));
    return true;
  } catch {
    return false;
  }
}

/**
 * Builds the pool of available workers with a strengths/weaknesses profile that
 * the planner uses to route subtasks. Claude Code and gemini-cli can edit files;
 * local Ollama models are text-only (great for isolated code, analysis, review).
 */
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

export async function discoverWorkers(clientProviders: ClientProvider[] = []): Promise<Worker[]> {
  const workers: Worker[] = [
    {
      id: "claude",
      kind: "claude-cli",
      model: "",
      label: "Claude Code",
      strengths: "Strongest at complex reasoning, software architecture, multi-file refactors, careful debugging and agentic file edits. Best for the hardest or most safety-critical coding subtasks. Higher cost.",
      editsFiles: true,
    },
  ];

  if (await geminiAvailable()) {
    workers.push({
      id: "gemini",
      kind: "gemini-cli",
      model: "",
      label: "Gemini CLI",
      strengths: "Very large context window and fast. Strong at broad codebase sweeps, boilerplate generation, wide-but-shallow changes, and reading lots of files at once. Can edit files. Free via login.",
      editsFiles: true,
    });
  }

  // Add a curated handful of local Ollama models (free, no file editing).
  try {
    const ollama = await fetchOllamaModels();
    const coder = ollama.find((m) => /coder/i.test(m.id));
    // Prefer larger / more capable general models for stability (e.g. gemma4:31b
    // over 26b). First available from this priority order wins.
    const generalPriority = [
      "qwen3.6:35b", "gemma4:31b", "nemotron3", "nemotron-cascade", "qwen3.6:27b",
      "mistral-small3.2", "glm-4.7-flash", "gemma4:26b", "gemma4:12b", "phi4",
    ];
    const general = generalPriority
      .map((p) => ollama.find((m) => m.id.startsWith(p) && m.id !== coder?.id))
      .find(Boolean);
    const picks = [coder, general].filter(Boolean).slice(0, 2) as { id: string; name: string }[];
    for (const m of picks) {
      const isCoder = /coder/i.test(m.id);
      workers.push({
        id: `ollama:${m.id}`,
        kind: "ollama",
        model: m.id,
        label: `Local: ${m.id}`,
        strengths: isCoder
          ? "Local coding specialist (free, runs offline). Great for self-contained functions/snippets, code explanation, and quick reviews. Cannot edit files directly — returns code/text that a file-editing worker or you applies."
          : "Local general model (free, runs offline). Good for analysis, summaries, drafting, and reviewing other workers' output. Cannot edit files directly.",
        editsFiles: false,
      });
    }
  } catch {
    /* ollama optional */
  }

  // Optional cloud/custom text workers from the user's configured providers.
  workers.push(...buildApiWorkers(clientProviders));

  return workers;
}

function buildOllamaWorker(model: string): Worker {
  return {
    id: `ollama:${model}`,
    kind: "ollama",
    model,
    label: `Local: ${model}`,
    strengths: "Local model (free, offline). Text-only — analysis, snippets, drafting, review. Cannot edit files.",
    editsFiles: false,
  };
}

/**
 * The full worker pool for the hybrid editor: the file-editing CLIs plus EVERY
 * installed Ollama chat model, so the user can manually route a subtask to any
 * local model (e.g. gemma4:31b).
 */
export async function discoverAllWorkers(clientProviders: ClientProvider[] = []): Promise<Worker[]> {
  const curated = await discoverWorkers(clientProviders);
  const cli = curated.filter((w) => w.kind !== "ollama");
  const ids = new Set(cli.map((w) => w.id));
  const out = [...cli];
  try {
    for (const m of await fetchOllamaModels()) {
      const w = buildOllamaWorker(m.id);
      if (!ids.has(w.id)) { ids.add(w.id); out.push(w); }
    }
  } catch { /* ollama optional */ }
  return out;
}

// Resolve a subtask's worker id against a list, building an Ollama worker on the
// fly for any ollama:<model> id (so manually-assigned local models always run).
function resolveWorker(workers: Worker[], id: string): Worker {
  const found = workers.find((w) => w.id === id);
  if (found) return found;
  if (id.startsWith("ollama:")) return buildOllamaWorker(id.slice("ollama:".length));
  return workers[0];
}

// --- Low-level model calls ---

async function runCliWorker(
  session: AssistantSessionRow,
  worker: Worker,
  prompt: string,
  emit: (e: NormalizedEvent) => void
): Promise<{ text: string; costUsd: number; isError: boolean }> {
  let text = "";
  const row: AssistantSessionRow = {
    id: session.id, // shared key so the stop endpoint can kill the active child
    externalId: null, // fresh run; subtasks coordinate via the shared filesystem
    provider: worker.kind === "gemini-cli" ? "gemini" : "claude",
    model: worker.model,
    cwd: session.cwd,
    permissionMode: session.permissionMode,
    allowedTools: session.allowedTools,
    // No interactive approval gate during orchestration (no live UI emitter is
    // registered for worker turns, so a hook would auto-deny). Keep the sandbox.
    approvalMode: "off",
    sandbox: session.sandbox,
  };
  const res = await runTurn(row, prompt, undefined, (e) => {
    if (e.type === "text" && e.content) {
      text += e.content;
      emit(e);
    } else if (e.type === "tool_use" || e.type === "tool_result" || e.type === "error") {
      emit(e);
    }
  });
  return { text, costUsd: res.costUsd, isError: res.isError };
}

async function runOllamaWorker(worker: Worker, prompt: string): Promise<{ text: string }> {
  const provider = createProvider("ollama", "");
  const text = await provider.sendMessage({
    messages: [{ role: "user", content: prompt }],
    model: worker.model,
  });
  return { text };
}

// Run a subtask on a cloud/custom OpenAI-compatible provider (text-only).
async function runApiWorker(worker: Worker, prompt: string): Promise<{ text: string }> {
  const providerId = worker.providerId || "";
  const def = getProvider(providerId);
  let model = worker.model;
  if (!model) {
    if (def?.staticModels?.length) {
      model = def.staticModels[0].id;
    } else {
      const live = await fetchOpenAICompatModels(providerId, worker.baseUrl || "", worker.apiKey);
      model = live[0]?.id || "";
    }
  }
  const provider = createProvider(providerId, worker.apiKey || "", { baseUrl: worker.baseUrl });
  const text = await provider.sendMessage({
    messages: [{ role: "user", content: prompt }],
    model,
  });
  return { text };
}

// Runs a worker for plain TEXT output (planning / synthesis), routing to the
// right backend by worker kind. CLI workers run a tool-less turn; Ollama/API
// workers are a single chat call. This is what lets the planner run on ANY
// configured model, not just Claude.
async function runText(
  session: AssistantSessionRow,
  worker: Worker,
  prompt: string,
  permissionMode = "plan"
): Promise<{ text: string; costUsd: number; isError: boolean }> {
  if (worker.kind === "ollama") {
    const r = await runOllamaWorker(worker, prompt);
    return { text: r.text, costUsd: 0, isError: false };
  }
  if (worker.kind === "api") {
    const r = await runApiWorker(worker, prompt);
    return { text: r.text, costUsd: 0, isError: false };
  }
  const row: AssistantSessionRow = {
    id: session.id,
    externalId: null,
    provider: worker.kind === "gemini-cli" ? "gemini" : "claude",
    model: worker.model,
    cwd: session.cwd,
    permissionMode, // read-only for planning/synthesis
    allowedTools: "", // no tools — pure text
  };
  let text = "";
  const res = await runTurn(row, prompt, undefined, (e) => {
    if (e.type === "text" && e.content) text += e.content;
  });
  return { text, costUsd: res.costUsd, isError: res.isError };
}

// Resolve which worker plans / synthesizes. An explicit id from the UI wins;
// otherwise "Auto" picks an AVAILABLE model without forcing a Claude account:
// Gemini (free, large context) > strongest local Ollama > a configured cloud API
// > Claude (last resort). This is the fix for the orchestrator hard-requiring Claude.
function resolvePlanner(workers: Worker[], plannerWorkerId?: string): Worker {
  const id = (plannerWorkerId || "").trim();
  if (id && id !== "auto") {
    const found = workers.find((w) => w.id === id);
    if (found) return found;
    if (id.startsWith("ollama:")) return buildOllamaWorker(id.slice("ollama:".length));
  }
  return (
    workers.find((w) => w.kind === "gemini-cli") ||
    workers.find((w) => w.kind === "ollama") ||
    workers.find((w) => w.kind === "api") ||
    workers.find((w) => w.kind === "claude-cli") ||
    workers[0]
  );
}

// --- Planner ---

function extractJson(s: string): string {
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : s;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}

async function plan(
  session: AssistantSessionRow,
  task: string,
  workers: Worker[],
  preference?: string,
  plannerWorkerId?: string
): Promise<PlannedSubtask[]> {
  const profile = workers
    .map((w) => `- ${w.id} (${w.label}, editsFiles=${w.editsFiles}): ${w.strengths}`)
    .join("\n");

  const prefLine = preference && preference.trim()
    ? `\nRouting preference from the user (honor it where quality allows): ${preference.trim()}\n`
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

  // Run the planner on the chosen (or Auto) model — no longer hardwired to Claude.
  const planner = resolvePlanner(workers, plannerWorkerId);

  // Fallback: if the planner narrated instead of returning JSON (common for
  // simple questions), don't fail — run the whole task as a single subtask on a
  // file-capable worker, which can read the project and answer/act.
  const fallback = (): PlannedSubtask[] => {
    const w = workers.find((x) => x.editsFiles) || workers[0];
    return [{ id: "s1", title: "Aufgabe bearbeiten", description: task, workerId: w?.id || "claude", dependsOn: [], editsFiles: !!w?.editsFiles }];
  };

  let raw = "";
  try {
    const r = await runText(session, planner, plannerPrompt, "plan");
    raw = r.text;
  } catch {
    return fallback();
  }

  let parsed: { subtasks?: PlannedSubtask[] };
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch {
    return fallback();
  }
  const subtasks = (parsed.subtasks || []).map((s, i) => ({
    id: s.id || `s${i + 1}`,
    title: s.title || `Subtask ${i + 1}`,
    description: s.description || "",
    workerId: workers.some((w) => w.id === s.workerId) ? s.workerId : "claude",
    dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn : [],
    editsFiles: !!s.editsFiles,
  }));
  return subtasks.length === 0 ? fallback() : subtasks;
}

// Topologically order subtasks by dependsOn (stable; ignores broken refs).
function orderSubtasks(subtasks: PlannedSubtask[]): PlannedSubtask[] {
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

export interface OrchestrationResult {
  costUsd: number;
  isError: boolean;
  records: { role: string; content: string; meta: string }[];
}

/** Plans without executing — used by the hybrid mode so the user can edit assignments. */
export async function planSubtasks(
  session: AssistantSessionRow,
  task: string,
  preference?: string,
  clientProviders: ClientProvider[] = [],
  plannerWorkerId?: string
): Promise<{ workers: Worker[]; subtasks: PlannedSubtask[] }> {
  const workers = await discoverWorkers(clientProviders);
  const subtasks = orderSubtasks(await plan(session, task, workers, preference, plannerWorkerId));
  return { workers, subtasks };
}

/**
 * Executes a given plan: run subtasks sequentially (dependency order, sharing
 * the working directory) -> synthesize. Emits live events and returns records
 * to persist plus total cost. Used by both auto and hybrid modes.
 */
export async function executePlan(
  session: AssistantSessionRow,
  task: string,
  subtasks: PlannedSubtask[],
  emit: (e: OrchEvent) => void,
  clientProviders: ClientProvider[] = [],
  plannerWorkerId?: string
): Promise<OrchestrationResult> {
  const records: { role: string; content: string; meta: string }[] = [];
  let totalCost = 0;
  let anyError = false;

  const workers = await discoverWorkers(clientProviders);
  emit({ type: "log", content: `Workers: ${workers.map((w) => w.id).join(", ")}` });

  emit({ type: "plan", subtasks });
  records.push({ role: "plan", content: task, meta: JSON.stringify({ subtasks, workers: workers.map((w) => ({ id: w.id, label: w.label })) }) });

  const results = new Map<string, string>();

  for (const st of subtasks) {
    const worker = resolveWorker(workers, st.workerId);
    emit({ type: "subtask_start", subtaskId: st.id, title: st.title, workerId: worker.id, workerLabel: worker.label });

    // Provide upstream results as context (file edits are already on disk for CLIs,
    // but a text summary helps both CLI and local workers stay aligned).
    const deps = st.dependsOn.map((d) => results.get(d)).filter(Boolean);
    const context = deps.length
      ? `\n\nContext from previous subtasks:\n${deps.map((c, i) => `[${i + 1}] ${String(c).slice(0, 1500)}`).join("\n")}`
      : "";
    const prompt = `${st.description}${context}\n\n(You are working in ${session.cwd}.)`;

    try {
      let text = "";
      if (worker.kind === "ollama") {
        const r = await runOllamaWorker(worker, prompt);
        text = r.text;
        emit({ type: "subtask_text", subtaskId: st.id, content: text });
      } else if (worker.kind === "api") {
        const r = await runApiWorker(worker, prompt);
        text = r.text;
        emit({ type: "subtask_text", subtaskId: st.id, content: text });
      } else {
        const r = await runCliWorker(session, worker, prompt, (e) => {
          if (e.type === "text" && e.content) emit({ type: "subtask_text", subtaskId: st.id, content: e.content });
        });
        text = r.text;
        totalCost += r.costUsd;
        if (r.isError) anyError = true;
      }
      results.set(st.id, text);
      records.push({ role: "assistant", content: text || "(kein Output)", meta: JSON.stringify({ subtaskId: st.id, title: st.title, worker: worker.label, workerId: worker.id }) });
      emit({ type: "subtask_end", subtaskId: st.id, workerLabel: worker.label });
    } catch (err) {
      anyError = true;
      const msg = `${worker.label} failed: ${err instanceof Error ? err.message : String(err)}`;
      emit({ type: "error", content: msg, subtaskId: st.id });
      records.push({ role: "error", content: msg, meta: JSON.stringify({ subtaskId: st.id }) });
    }
  }

  // Synthesis: a concise wrap-up of what the workers produced.
  try {
    const summaryInput = subtasks
      .map((s) => `### ${s.title} (${resolveWorker(workers, s.workerId).label})\n${String(results.get(s.id) || "").slice(0, 2000)}`)
      .join("\n\n");
    const synthPrompt = `You orchestrated multiple AI workers on this task:\n"${task}"\n\nHere is what each worker produced:\n\n${summaryInput}\n\nWrite a concise final summary for the user: what was accomplished across the subtasks, any files changed, and any follow-ups or caveats. Do not use any tools.`;

    // Synthesize on the same model that planned (or Auto) — not hardwired to Claude.
    const synthWorker = resolvePlanner(workers, plannerWorkerId);
    const res = await runText(session, synthWorker, synthPrompt, "plan");
    const synth = res.text;
    totalCost += res.costUsd;
    if (synth.trim()) { emit({ type: "synthesis", content: synth }); records.push({ role: "synthesis", content: synth.trim(), meta: "{}" }); }
  } catch (err) {
    emit({ type: "error", content: `Synthesis failed: ${err instanceof Error ? err.message : String(err)}` });
  }

  emit({ type: "done" });
  return { costUsd: totalCost, isError: anyError, records };
}

/** Auto mode: plan + execute in one shot. */
export async function orchestrate(
  session: AssistantSessionRow,
  task: string,
  emit: (e: OrchEvent) => void,
  preference?: string,
  clientProviders: ClientProvider[] = [],
  plannerWorkerId?: string
): Promise<OrchestrationResult> {
  let subtasks: PlannedSubtask[];
  try {
    ({ subtasks } = await planSubtasks(session, task, preference, clientProviders, plannerWorkerId));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Planning failed";
    emit({ type: "error", content: msg });
    return { costUsd: 0, isError: true, records: [{ role: "error", content: msg, meta: "{}" }] };
  }
  return executePlan(session, task, subtasks, emit, clientProviders, plannerWorkerId);
}
