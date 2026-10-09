import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { StringDecoder } from "string_decoder";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { approvalTimeoutMs, hookToken } from "./approvals";
import { GITHUB_SANDBOX_DOMAINS, githubEnv } from "@/lib/github";
import {
  PI_INSTALL_HINT,
  PiEventMapper,
  ensureSettings,
  findPiModel,
  isValidPiModelId,
  mapToolsForPi,
  piBin,
  piEnv,
  piGatedTools,
  piRequestedModel,
  piSessionIdFor,
  piSessionsDir,
  syncOllamaModels,
  type PiMapped,
} from "./pi";

export interface AssistantSessionRow {
  id: string;
  externalId: string | null;
  provider: string;
  model: string;
  cwd: string;
  permissionMode: string;
  allowedTools: string;
  approvalMode?: string; // off | edits | all
  sandbox?: boolean;
  // When true (someone can answer: PWA/Telegram turns, orchestrator subtasks
  // that change files), Claude Code gets CodeMaestro's permission-prompt tool
  // (scripts/assistant-permission-mcp.mjs): AskUserQuestion / ExitPlanMode
  // become available headless and surface as clickable cards, and tool calls
  // that would need a permission prompt become approval cards instead of
  // being denied silently. Left off for unattended runs (loops, read-only
  // workers), which keep `claude -p`'s silent deny.
  interactive?: boolean;
  // With externalId: continue a copy of that conversation (--fork-session)
  // instead of the conversation itself — orchestrator workers get the
  // session's context without writing into its thread.
  forkSession?: boolean;
  // One-shot Claude run (orchestrator planner, workers, reviews): not stored
  // as a conversation (--no-session-persistence), so it never shows up as a
  // project conversation to continue.
  ephemeral?: boolean;
}

const HOOK_PATH = path.join(process.cwd(), "scripts", "assistant-approval-hook.mjs");
// Permission-prompt tool (stdio MCP server) for interactive Claude runs.
const PERMISSION_MCP_PATH = path.join(process.cwd(), "scripts", "assistant-permission-mcp.mjs");
const PERMISSION_MCP_SERVER = "codemaestro";
export const PERMISSION_PROMPT_TOOL = `mcp__${PERMISSION_MCP_SERVER}__permission`;
// pi approval gate (a pi extension; pi refuses to start when it fails to load).
const PI_EXTENSION_PATH = path.join(process.cwd(), "scripts", "pi-approval-extension.ts");
// Silence from a local model before the thread gets a "waiting for Ollama" notice.
const STALL_NOTICE_MS = 90_000;
const STALL_CHECK_MS = 15_000;

// POSIX single-quote a path for the shell that runs hook commands, so paths
// with spaces or quotes (e.g. "/Users/Jane Doe/…") can't split the command.
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Base URL the approval hook (a child of the CLI) uses to call back. */
export function internalBaseUrl(): string {
  const explicit = process.env.CODEMAESTRO_INTERNAL_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  return `http://127.0.0.1:${process.env.PORT || "3000"}`;
}

export class ApprovalHookMissingError extends Error {
  constructor() {
    super(`Freigabe-Hook fehlt (${HOOK_PATH}). Ohne Hook kann die Freigabe nicht erzwungen werden — Ausführung abgebrochen.`);
  }
}

// Builds a Claude Code --settings file (PreToolUse approval hook + optional
// sandbox) for this turn. Returns the file path, or null if neither is needed.
// `github`: GitHub credentials are injected this turn, so a sandboxed run must
// be able to reach GitHub (git/gh over HTTPS honour the sandbox proxy).
function buildSettingsFile(session: AssistantSessionRow, opts: { github: boolean }): string | null {
  const approval = session.approvalMode && session.approvalMode !== "off";
  const wantQuestions = !!session.interactive;
  if (!approval && !session.sandbox && !wantQuestions) return null;

  // Fail closed: an approval gate whose hook can't run would let every tool
  // call through (Claude Code treats a crashing hook as non-blocking).
  const hookAvailable = existsSync(HOOK_PATH);
  if (approval && !hookAvailable) throw new ApprovalHookMissingError();
  const hookCmd = `${shellQuote(process.execPath)} ${shellQuote(HOOK_PATH)}`;
  // Hook timeout (seconds) must outlast the approval wait so the hook — not
  // Claude Code — decides what happens on timeout.
  const timeout = Math.ceil(approvalTimeoutMs() / 1000) + 60;
  const preToolUse: Array<Record<string, unknown>> = [];
  // Always intercept interactive questions on live turns so the UI can show
  // clickable options (otherwise they appear as an unanswerable tool call).
  if (wantQuestions && hookAvailable) {
    preToolUse.push({ matcher: "AskUserQuestion|ExitPlanMode", hooks: [{ type: "command", command: hookCmd, timeout }] });
  }
  if (approval) {
    const matcher = session.approvalMode === "all" ? "Edit|Write|MultiEdit|NotebookEdit|Bash" : "Edit|Write|MultiEdit|NotebookEdit";
    preToolUse.push({ matcher, hooks: [{ type: "command", command: hookCmd, timeout }] });
  }
  const settings: Record<string, unknown> = {};
  if (preToolUse.length) settings.hooks = { PreToolUse: preToolUse };
  if (session.sandbox) {
    // Only widens the network allow-list; filesystem limits stay and git/gh are
    // not excluded from the sandbox (an excluded `gh *` could run arbitrary
    // gh extensions unsandboxed).
    settings.sandbox = opts.github
      ? { enabled: true, network: { allowedDomains: GITHUB_SANDBOX_DOMAINS } }
      : { enabled: true };
  }

  const file = path.join(tmpdir(), `pb-settings-${session.id}-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(settings));
  return file;
}

/** Child env of the approval bridge (hook and permission tool). */
function bridgeEnv(session: AssistantSessionRow): Record<string, string> {
  return {
    PB_BASE_URL: internalBaseUrl(),
    PB_SESSION_ID: session.id,
    PB_HOOK_TOKEN: hookToken(),
    PB_APPROVAL_TIMEOUT_MS: String(approvalTimeoutMs()),
  };
}

/**
 * Writes the --mcp-config file that registers the permission-prompt tool for
 * an interactive Claude run, or returns null (not interactive / script
 * missing — then `claude -p` keeps denying silently, as before). The bridge
 * env goes into the file (0600) rather than the command line, where the hook
 * token would show up in `ps`.
 */
function buildPermissionMcpFile(session: AssistantSessionRow): string | null {
  if (!session.interactive || !existsSync(PERMISSION_MCP_PATH)) return null;
  const config = {
    mcpServers: {
      [PERMISSION_MCP_SERVER]: {
        type: "stdio",
        command: process.execPath,
        args: [PERMISSION_MCP_PATH],
        env: bridgeEnv(session),
      },
    },
  };
  const file = path.join(tmpdir(), `pb-mcp-${session.id}-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
  return file;
}

const removeFile = (file: string | null) => {
  if (file) { try { unlinkSync(file); } catch { /* ignore */ } }
};

export interface NormalizedEvent {
  // "notice": an informational line for the transcript (stored as a system row).
  type: "init" | "text" | "thinking" | "tool_use" | "tool_result" | "result" | "error" | "done" | "knowledge" | "notice";
  content?: string;
  name?: string;
  input?: unknown;
  toolUseId?: string;
  isError?: boolean;
  sessionId?: string;
  model?: string;
  costUsd?: number;
  sources?: string[]; // knowledge-base doc titles injected this turn (type "knowledge")
}

export interface TurnResult {
  externalId: string | null;
  costUsd: number;
  isError: boolean;
}

// Every live CLI child per assistant session (a turn, an orchestrator worker,
// a planner …), so Stop can terminate all of them. Process-wide (globalThis)
// because route handlers and the instrumentation-started Telegram bridge live
// in different Next.js module graphs.
const gp = globalThis as unknown as { __cmProcs?: Map<string, Set<ChildProcessWithoutNullStreams>> };
const procs: Map<string, Set<ChildProcessWithoutNullStreams>> = (gp.__cmProcs ??= new Map());

function trackProc(sessionId: string, child: ChildProcessWithoutNullStreams) {
  let set = procs.get(sessionId);
  if (!set) procs.set(sessionId, (set = new Set()));
  set.add(child);
}

function untrackProc(sessionId: string, child: ChildProcessWithoutNullStreams) {
  const set = procs.get(sessionId);
  if (!set) return;
  set.delete(child);
  if (set.size === 0) procs.delete(sessionId);
}

// Children are spawned as process-group leaders (detached) on POSIX so a kill
// also reaches the shells/tools they started (e.g. a hanging Bash command).
function killTree(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals) {
  try {
    if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    try { child.kill(signal); } catch { /* already gone */ }
  }
}

// First stop signal per child when it isn't SIGINT (process-wide like `procs`).
// pi runs bash commands in their own process groups and kills them only on
// SIGTERM/SIGHUP; on SIGINT it dies at once and leaves a running command behind.
const gs = globalThis as unknown as { __cmStopSignals?: WeakMap<ChildProcessWithoutNullStreams, NodeJS.Signals> };
const stopSignals: WeakMap<ChildProcessWithoutNullStreams, NodeJS.Signals> = (gs.__cmStopSignals ??= new WeakMap());

// SIGINT first: Claude Code ends an interrupted turn cleanly on SIGINT, while
// SIGTERM (exit 143) leaves the turn unfinished in its session transcript.
// Escalate if the process group doesn't exit.
function terminate(child: ChildProcessWithoutNullStreams) {
  killTree(child, stopSignals.get(child) ?? "SIGINT");
  const alive = () => child.exitCode === null && child.signalCode === null;
  const t1 = setTimeout(() => { if (alive()) killTree(child, "SIGTERM"); }, 3000);
  const t2 = setTimeout(() => { if (alive()) killTree(child, "SIGKILL"); }, 8000);
  t1.unref?.();
  t2.unref?.();
}

/** Terminates every CLI process of a session. Returns true if any was running. */
export function stopSession(sessionId: string): boolean {
  const set = procs.get(sessionId);
  if (!set || set.size === 0) return false;
  for (const child of set) terminate(child);
  return true;
}

export function isRunning(sessionId: string): boolean {
  return (procs.get(sessionId)?.size ?? 0) > 0;
}

// --- externalId markers --------------------------------------------------------
// AssistantSession.externalId is UNIQUE. Real CLI session ids (Claude UUIDs) are
// stored as-is; agents without resumable ids get a per-session marker instead of
// a shared literal (which made the 2nd session of the same agent fail the DB
// update and stay "running" forever).
const MARKER_SEP = "~";

function markerFor(provider: string, sessionId: string): string {
  return `${provider}${MARKER_SEP}${sessionId}`;
}

/** True for our synthetic "already started" markers (not a resumable CLI id). */
export function isMarker(externalId: string | null | undefined): boolean {
  return !!externalId && externalId.includes(MARKER_SEP);
}

/**
 * Providers whose approval gate CodeMaestro can enforce (Claude Code's
 * PreToolUse hook, pi's approval extension). Others run their tools directly.
 */
export function supportsApprovalGate(provider: string): boolean {
  return provider === "claude" || provider === "pi";
}

/** Providers that can run inside CodeMaestro's sandbox (Claude Code only). */
export function supportsSandbox(provider: string): boolean {
  return provider === "claude";
}

function claudeArgs(session: AssistantSessionRow, prompt: string, settingsFile: string | null, mcpFile: string | null = null): string[] {
  // --include-partial-messages streams text token by token (stream_event).
  const args = ["-p", prompt, "--output-format", "stream-json", "--verbose", "--include-partial-messages"];
  if (session.externalId) {
    args.push("--resume", session.externalId);
    if (session.forkSession) args.push("--fork-session");
  }
  if (session.ephemeral) args.push("--no-session-persistence");
  if (session.model) args.push("--model", session.model);
  args.push("--permission-mode", session.permissionMode || "default");
  const tools = (session.allowedTools || "").trim();
  if (tools) args.push("--allowedTools", tools);
  if (settingsFile) args.push("--settings", settingsFile);
  // --mcp-config takes several values; the next option ends the list.
  if (mcpFile) args.push("--mcp-config", mcpFile, "--permission-prompt-tool", PERMISSION_PROMPT_TOOL);
  // Confine file access to the working directory.
  args.push("--add-dir", session.cwd);
  return args;
}

// Map our Claude-style permission modes onto gemini-cli's approval modes.
function geminiApproval(mode: string): string {
  switch (mode) {
    case "bypassPermissions": return "yolo";
    case "acceptEdits": return "auto_edit";
    case "plan": return "plan";
    default: return "default";
  }
}

// Claude Code tool names (what the UI offers) → gemini-cli built-in tool names.
const GEMINI_TOOL_NAMES: Record<string, string[]> = {
  Read: ["read_file", "read_many_files", "list_directory"],
  Grep: ["search_file_content"],
  Glob: ["glob"],
  Bash: ["run_shell_command"],
  Edit: ["replace"],
  Write: ["write_file"],
  WebSearch: ["google_web_search"],
  WebFetch: ["web_fetch"],
};

export function mapToolsForGemini(csv: string): string {
  const out = new Set<string>();
  for (const t of csv.split(",").map((x) => x.trim()).filter(Boolean)) {
    // Own keys only: allowedTools is free text, and "constructor"/"toString"
    // would otherwise resolve to Object.prototype functions (not iterable).
    for (const g of Object.hasOwn(GEMINI_TOOL_NAMES, t) ? GEMINI_TOOL_NAMES[t] : [t]) out.add(g);
  }
  return [...out].join(",");
}

function geminiArgs(session: AssistantSessionRow, prompt: string): string[] {
  const args = ["-p", prompt, "--output-format", "json", "--skip-trust"];
  if (session.model) args.push("--model", session.model);
  args.push("--approval-mode", geminiApproval(session.permissionMode || "default"));
  const tools = mapToolsForGemini(session.allowedTools || "");
  if (tools) args.push("--allowed-tools", tools);
  // Resume this session's own gemini conversation when the CLI reported an id;
  // fall back to "latest" (most recent in the cwd) only for legacy markers.
  if (session.externalId) {
    args.push("--resume", isMarker(session.externalId) ? "latest" : session.externalId);
  }
  return args;
}

// --- Additional CLI coding agents (plain stdout, no structured tool stream) ---
// These drive their own file edits on disk; we surface their textual output.
// They are inert (graceful error) until the corresponding binary is installed.
export interface PlainAgentDef {
  bin: string;
  label: string;
  install: string; // hint shown when the binary isn't on PATH
}

export const PLAIN_AGENTS: Record<string, PlainAgentDef> = {
  opencode: { bin: "opencode", label: "OpenCode", install: "npm i -g opencode-ai  (oder: brew install sst/tap/opencode)" },
  codex: { bin: "codex", label: "Codex CLI", install: "npm i -g @openai/codex" },
  aider: { bin: "aider", label: "Aider", install: "pipx install aider-chat  (oder: pip install aider-chat)" },
};

export function isPlainAgent(provider: string): boolean {
  return Object.hasOwn(PLAIN_AGENTS, provider); // not `in`: "constructor" is no agent
}

// Build argv for a plain agent's one-shot, non-interactive run.
function plainArgs(provider: string, session: AssistantSessionRow, prompt: string): string[] {
  if (provider === "opencode") {
    const args = ["run"];
    if (session.model) args.push("--model", session.model);
    // Continue the previous OpenCode session in this dir on follow-up turns.
    if (session.externalId) args.push("--continue");
    args.push(prompt);
    return args;
  }
  if (provider === "codex") {
    const args = ["exec", "--skip-git-repo-check"];
    if (session.model) args.push("--model", session.model);
    args.push(prompt);
    return args;
  }
  // aider
  const args = ["--message", prompt, "--yes-always", "--no-stream"];
  if (session.model) args.push("--model", session.model);
  return args;
}

// --- pi (every local Ollama model as a file-editing agent) ----------------------
interface PiTurn {
  args: string[];
  env: Record<string, string>;
  mapper: PiEventMapper;
}

/**
 * Resolves model, tools, session id and approval gate for a pi turn. The
 * prompt goes to stdin (a prompt argument starting with "@" is read as a file).
 */
function piTurn(session: AssistantSessionRow, models: Array<{ id: string; toolsOk: boolean }>, syncError?: string): PiTurn | { error: string } {
  const requested = piRequestedModel(session.model);
  const model = findPiModel(models, requested)?.id || requested || models.find((m) => m.toolsOk)?.id;
  if (!model) {
    return { error: syncError || "Kein Ollama-Modell mit Tool-Unterstützung gefunden — bitte ein Modell installieren oder in der Session angeben." };
  }
  if (!isValidPiModelId(model)) return { error: `Ungültige Modell-ID für pi: ${model}` };
  if (!models.length && syncError) return { error: syncError };
  // A fresh sync is authoritative: fail with a clear hint instead of letting
  // pi send an unknown id (Ollama would only answer "model not found").
  if (!syncError && !models.some((m) => m.id === model)) {
    return { error: `Das Modell „${model}“ ist auf dem KI-Server (Ollama) nicht installiert oder kein Chat-Modell. Installieren mit: ollama pull ${model}` };
  }
  // Models without tool calling (per Ollama) run as plain chat.
  const toolsOk = models.find((m) => m.id === model)?.toolsOk ?? true;
  const tools = toolsOk ? mapToolsForPi(session.allowedTools || "", session.permissionMode) : [];
  const gated = piGatedTools(session.approvalMode);
  // Fail closed: the gate the session asked for must be loadable.
  if (gated.length && !existsSync(PI_EXTENSION_PATH)) {
    return { error: `Freigabe-Erweiterung fehlt (${PI_EXTENSION_PATH}). Ohne sie kann die Freigabe nicht erzwungen werden — Ausführung abgebrochen.` };
  }

  const args = [
    "--mode", "json",
    "--model", `ollama/${model}`,
    "--session-dir", piSessionsDir(),
    "--session-id", piSessionIdFor(session.id, session.externalId),
  ];
  // One-off rows (orchestra subtasks, loops) are never resumed: no session
  // file, or every subtask leaves one behind in .codemaestro/pi-agent/sessions.
  if (session.ephemeral) args.push("--no-session");
  if (tools.length) args.push("--tools", tools.join(","));
  else args.push("--no-tools");
  // Only our own gate: no discovered/built-in extensions, MCP, skills, prompt
  // templates or themes, and nothing trust-gated from the project's .pi/.
  args.push("--no-extensions");
  if (gated.length) args.push("-e", PI_EXTENSION_PATH);
  args.push("--no-mcp", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-approve");

  const env: Record<string, string> = { ...piEnv() };
  if (gated.length) {
    Object.assign(env, bridgeEnv(session));
    env.CM_PI_GATED = gated.join(",");
  }
  return { args, env, mapper: new PiEventMapper(model) };
}

// Token deltas are coalesced (~80 ms) so a long answer doesn't flood the run
// buffer with one event per token; anything else flushes pending text first.
function deltaCoalescer(emit: (e: NormalizedEvent) => void) {
  let pending: { type: "text" | "thinking"; content: string } | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (pending) { const p = pending; pending = null; emit({ type: p.type, content: p.content }); }
  };
  const delta = (type: "text" | "thinking", content: string) => {
    if (pending && pending.type !== type) flush();
    pending = pending ? { type, content: pending.content + content } : { type, content };
    if (pending.content.length >= 2000) flush();
    else if (!flushTimer) flushTimer = setTimeout(flush, 80);
  };
  const now = (e: NormalizedEvent) => { flush(); emit(e); };
  return { delta, flush, now };
}

interface ClaudeStreamLine {
  type: string;
  subtype?: string;
  session_id?: string;
  model?: string;
  message?: { id?: string; content?: Array<{ type: string; text?: string; thinking?: string; name?: string; input?: unknown; id?: string; tool_use_id?: string; content?: unknown; is_error?: boolean }> };
  // --include-partial-messages: raw Messages API stream events.
  event?: {
    type: string;
    message?: { id?: string };
    delta?: { type: string; text?: string; thinking?: string };
  };
  result?: string;
  total_cost_usd?: number;
  is_error?: boolean;
  // Tool calls `claude -p` denied because nobody could approve them.
  permission_denials?: Array<{ tool_name?: string; tool_input?: Record<string, unknown> }>;
}

// Claude Code's error for `--resume <id>` when the conversation is not stored
// for this working directory (moved project, cleaned ~/.claude, other user).
const RESUME_MISSING = /No conversation found with session ID/i;

/** One line per denied tool call, e.g. "Bash: npm install". */
export function describeDenials(denials: ClaudeStreamLine["permission_denials"]): string[] {
  const out: string[] = [];
  for (const d of denials ?? []) {
    const tool = d?.tool_name || "Werkzeug";
    const input = d?.tool_input ?? {};
    const target = [input.command, input.file_path, input.notebook_path, input.url, input.pattern, input.query]
      .find((v) => typeof v === "string" && v.trim());
    const line = target ? `${tool}: ${String(target).replace(/\s+/g, " ").trim()}` : tool;
    if (!out.includes(line)) out.push(line.length > 200 ? `${line.slice(0, 199)}…` : line);
  }
  return out;
}

type TurnAttempt = TurnResult & { resumeMissing?: boolean };

/**
 * Runs one assistant turn by spawning the CLI, parsing its stream-json/json
 * output, and invoking `emit` for each normalized event. Resolves when the
 * process exits. The child is registered in `procs` so it can be stopped.
 *
 * A Claude conversation that cannot be resumed (`--resume` finds nothing for
 * this working directory) is not a dead end: the turn reports it once and
 * runs again as a new conversation.
 */
export async function runTurn(
  session: AssistantSessionRow,
  prompt: string,
  apiKey: string | undefined,
  emit: (e: NormalizedEvent) => void,
  opts: { signal?: AbortSignal } = {}
): Promise<TurnResult> {
  const first = await runTurnOnce(session, prompt, apiKey, emit, opts);
  if (!first.resumeMissing) return { externalId: first.externalId, costUsd: first.costUsd, isError: first.isError };
  emit({
    type: "notice",
    content: `Die bisherige Claude-Code-Unterhaltung (${session.externalId?.slice(0, 8)}…) gibt es in ${session.cwd} nicht mehr — es startet eine neue Unterhaltung.`,
  });
  const retry = await runTurnOnce({ ...session, externalId: null, forkSession: false }, prompt, apiKey, emit, opts);
  return { externalId: retry.externalId, costUsd: retry.costUsd, isError: retry.isError };
}

async function runTurnOnce(
  session: AssistantSessionRow,
  prompt: string,
  apiKey: string | undefined,
  emit: (e: NormalizedEvent) => void,
  opts: { signal?: AbortSignal }
): Promise<TurnAttempt> {
  const plain = isPlainAgent(session.provider);
  const isGemini = session.provider === "gemini";
  const isPi = session.provider === "pi";
  const kind: "claude" | "gemini" | "plain" | "pi" = plain ? "plain" : isGemini ? "gemini" : isPi ? "pi" : "claude";

  // Connected GitHub account (Settings → GitHub): token + git credential
  // helper for every provider, so the agent can push and use gh. Empty when
  // not connected or disabled; never throws. Awaited before the abort check so
  // nothing async sits between that check and spawn + abort-listener setup.
  const ghEnv = await githubEnv();
  const github = Object.keys(ghEnv).length > 0;

  // pi: refresh the Ollama model list + pi's models.json/settings.json (cached;
  // never throws — an outage keeps the last good list).
  let piSync: Awaited<ReturnType<typeof syncOllamaModels>> | null = null;
  let piSetupError: string | null = null;
  if (kind === "pi") {
    piSync = await syncOllamaModels();
    // A model pulled after the cached sync: look again before reporting it missing.
    const requested = piRequestedModel(session.model);
    if (requested && !piSync.error && !findPiModel(piSync.models, requested)) {
      piSync = await syncOllamaModels({ force: true });
    }
    try {
      await ensureSettings();
    } catch (err) {
      piSetupError = `pi-Konfiguration konnte nicht geschrieben werden: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  if (opts.signal?.aborted) {
    return { externalId: session.externalId, costUsd: 0, isError: true };
  }

  // Fail closed: never run a provider without the approval gate the session
  // asked for (Claude Code's hooks / pi's extension can enforce it).
  if (session.approvalMode && session.approvalMode !== "off" && !supportsApprovalGate(session.provider)) {
    emit({
      type: "error",
      content: "Das Freigabe-Gate wird für diesen Provider nicht unterstützt. Bitte eine Session ohne Freigabe-Modus anlegen oder Claude Code verwenden.",
    });
    emit({ type: "done" });
    return { externalId: session.externalId, costUsd: 0, isError: true };
  }

  // pi: resolve model/tools/gate. pi has no sandbox, so a sandboxed session
  // fails closed (read-only Gemini workers of sandboxed sessions are restricted
  // by the orchestrator instead and keep running).
  let pi: PiTurn | null = null;
  if (kind === "pi" && piSync) {
    const prep: PiTurn | { error: string } = session.sandbox && !supportsSandbox(session.provider)
      ? { error: "Die Sandbox wird für pi nicht unterstützt. Bitte eine Session ohne Sandbox anlegen oder Claude Code verwenden." }
      : piSetupError
        ? { error: piSetupError }
        : piTurn(session, piSync.models, piSync.error);
    if ("error" in prep) {
      emit({ type: "error", content: prep.error });
      emit({ type: "done" });
      return { externalId: session.externalId, costUsd: 0, isError: true };
    }
    pi = prep;
  }

  // Approval hook + sandbox are Claude-Code-specific (PreToolUse settings), as
  // is the permission-prompt tool of interactive runs.
  let settingsFile: string | null = null;
  let mcpFile: string | null = null;
  if (kind === "claude") {
    try {
      settingsFile = buildSettingsFile(session, { github });
      mcpFile = buildPermissionMcpFile(session);
    } catch (err) {
      removeFile(settingsFile);
      emit({ type: "error", content: err instanceof Error ? err.message : String(err) });
      emit({ type: "done" });
      return { externalId: session.externalId, costUsd: 0, isError: true };
    }
  }
  const bin = plain ? PLAIN_AGENTS[session.provider].bin : isGemini ? "gemini" : pi ? piBin() : "claude";
  const args = plain
    ? plainArgs(session.provider, session, prompt)
    : isGemini
      ? geminiArgs(session, prompt)
      : pi
        ? pi.args
        : claudeArgs(session, prompt, settingsFile, mcpFile);

  const env: NodeJS.ProcessEnv = { ...process.env, ...ghEnv };
  if (isGemini && apiKey) {
    env.GEMINI_API_KEY = apiKey;
    env.GOOGLE_API_KEY = apiKey;
  }
  if (kind === "claude" && apiKey) {
    // Optional: allow overriding Claude auth with an explicit key.
    env.ANTHROPIC_API_KEY = apiKey;
  }
  // The approval hook (a child of claude) calls back into this server and
  // authenticates with a per-process token.
  if (settingsFile) Object.assign(env, bridgeEnv(session));
  if (mcpFile) {
    // The permission tool waits for the user as long as an approval may take;
    // Claude Code must not give up on the MCP call first.
    const wait = approvalTimeoutMs() + 120_000;
    if (!(Number(env.MCP_TOOL_TIMEOUT) >= wait)) env.MCP_TOOL_TIMEOUT = String(wait);
  }
  if (pi) Object.assign(env, pi.env);

  const installHint = plain
    ? ` (nicht installiert? ${PLAIN_AGENTS[session.provider].install})`
    : pi ? ` (nicht installiert? ${PI_INSTALL_HINT})` : "";

  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(bin, args, { cwd: session.cwd, env, detached: process.platform !== "win32" });
  } catch (err) {
    removeFile(settingsFile);
    removeFile(mcpFile);
    emit({ type: "error", content: `Failed to start ${bin}: ${err instanceof Error ? err.message : String(err)}${installHint}` });
    return { externalId: session.externalId, costUsd: 0, isError: true };
  }

  if (pi) {
    // pi reads the prompt from stdin until EOF (an argument starting with "@"
    // would be read as a file). Ignore EPIPE when pi exits early.
    child.stdin.on("error", () => {});
    child.stdin.end(prompt);
    // Stop with SIGTERM: pi then also kills a running bash tool (the session
    // file stays resumable).
    stopSignals.set(child, "SIGTERM");
  } else {
    // The prompt is passed as an argument; close stdin so no CLI waits for
    // piped input.
    child.stdin.end();
  }

  trackProc(session.id, child);
  const onAbort = () => terminate(child);
  opts.signal?.addEventListener("abort", onAbort, { once: true });

  let externalId = session.externalId;
  let costUsd = 0;
  let isError = false;
  let sawInit = false;
  let stdoutBuffer = "";
  let stderr = "";
  // Decode UTF-8 across chunk boundaries (a multi-byte character can be split).
  const outDecoder = new StringDecoder("utf8");
  const errDecoder = new StringDecoder("utf8");

  const { delta: emitDelta, flush: flushPending, now: emitNow } = deltaCoalescer(emit);

  // Messages whose text/thinking already streamed as deltas; their final
  // "assistant" event must not repeat it.
  let currentMessageId: string | undefined;
  const streamedText = new Set<string>();
  const streamedThinking = new Set<string>();

  const handleClaudeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let obj: ClaudeStreamLine;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (obj.type === "system" && obj.subtype === "init") {
      sawInit = true;
      if (obj.session_id) externalId = obj.session_id;
      emitNow({ type: "init", sessionId: obj.session_id, model: obj.model });
      return;
    }
    if (obj.type === "stream_event" && obj.event) {
      const ev = obj.event;
      if (ev.type === "message_start") {
        currentMessageId = ev.message?.id;
      } else if (ev.type === "content_block_delta" && ev.delta) {
        if (ev.delta.type === "text_delta" && ev.delta.text) {
          if (currentMessageId) streamedText.add(currentMessageId);
          emitDelta("text", ev.delta.text);
        } else if (ev.delta.type === "thinking_delta" && ev.delta.thinking) {
          if (currentMessageId) streamedThinking.add(currentMessageId);
          emitDelta("thinking", ev.delta.thinking);
        }
      }
      return;
    }
    if (obj.type === "assistant" && obj.message?.content) {
      const id = obj.message.id;
      for (const block of obj.message.content) {
        if (block.type === "text" && block.text) {
          if (!(id && streamedText.has(id))) emitNow({ type: "text", content: block.text });
        } else if (block.type === "thinking" && block.thinking) {
          if (!(id && streamedThinking.has(id))) emitNow({ type: "thinking", content: block.thinking });
        } else if (block.type === "tool_use") {
          emitNow({ type: "tool_use", name: block.name, input: block.input, toolUseId: block.id });
        }
      }
      return;
    }
    if (obj.type === "user" && obj.message?.content) {
      for (const block of obj.message.content) {
        if (block.type === "tool_result") {
          const c = typeof block.content === "string"
            ? block.content
            : JSON.stringify(block.content);
          emitNow({ type: "tool_result", toolUseId: block.tool_use_id, content: c, isError: block.is_error });
        }
      }
      return;
    }
    if (obj.type === "result") {
      if (obj.session_id) externalId = obj.session_id;
      if (typeof obj.total_cost_usd === "number") costUsd = obj.total_cost_usd;
      isError = !!obj.is_error;
      // Unattended runs deny what would need a prompt without asking; say so,
      // otherwise the agent's "waiting for approval" has no visible cause.
      const denied = session.interactive ? [] : describeDenials(obj.permission_denials);
      if (denied.length) {
        emitNow({
          type: "notice",
          content: `Ohne Freigabe blockiert (${denied.length}): ${denied.slice(0, 8).join(" · ")}${denied.length > 8 ? " · …" : ""}. Erlaube die Werkzeuge in der Session oder starte die Aufgabe als normale Nachricht, dann kommen Freigabe-Karten.`,
        });
      }
      emitNow({ type: "result", content: obj.result, costUsd, isError });
    }
  };

  const routePi = (mapped: PiMapped[]) => {
    if (!pi) return;
    for (const m of mapped) {
      if (m.kind === "delta") emitDelta(m.type, m.content);
      else emitNow(m.event);
    }
    if (pi.mapper.externalId) externalId = pi.mapper.externalId;
    if (pi.mapper.isError) isError = true;
  };
  const handleLine = (line: string) => {
    if (pi) routePi(pi.mapper.handleLine(line));
    else handleClaudeLine(line);
  };

  // A local model that answers nothing for minutes is usually Ollama loading
  // a model (or evicting one for another client), not a hung agent. Say so
  // once per turn, so the thread shows a cause instead of a silent wait.
  let lastOutputAt = Date.now();
  let stallNoticed = false;
  const stallTimer = pi
    ? setInterval(() => {
        if (stallNoticed || Date.now() - lastOutputAt < STALL_NOTICE_MS) return;
        stallNoticed = true;
        emitNow({
          type: "notice",
          content: `Seit ${Math.round(STALL_NOTICE_MS / 1000)} s keine Antwort vom lokalen Modell. Ollama lädt vermutlich gerade ein Modell oder ist durch einen anderen Client belegt; der Lauf wartet weiter.`,
        });
      }, STALL_CHECK_MS)
    : null;
  stallTimer?.unref?.();

  return await new Promise<TurnAttempt>((resolve) => {
    child.stdout.on("data", (chunk: Buffer) => {
      lastOutputAt = Date.now();
      stallNoticed = false;
      const text = outDecoder.write(chunk);
      if (!text) return;
      if (kind === "gemini") {
        stdoutBuffer += text;
        return; // gemini returns a single JSON object; parse at close
      }
      if (kind === "plain") {
        // No structured stream — surface stdout live as assistant text.
        emit({ type: "text", content: text });
        return;
      }
      stdoutBuffer += text;
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) handleLine(line);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      // Keep only the tail — it holds the useful error and bounds memory.
      stderr = (stderr + errDecoder.write(chunk)).slice(-20_000);
    });

    child.on("error", (err) => {
      const enoent = (err as NodeJS.ErrnoException).code === "ENOENT";
      emit({ type: "error", content: enoent ? `${bin} nicht gefunden${installHint}` : err.message });
      isError = true;
    });

    child.on("close", (code, signal) => {
      if (stallTimer) clearInterval(stallTimer);
      untrackProc(session.id, child);
      opts.signal?.removeEventListener("abort", onAbort);
      removeFile(settingsFile);
      removeFile(mcpFile);
      const tail = outDecoder.end();
      if (tail) {
        if (kind === "plain") emit({ type: "text", content: tail });
        else stdoutBuffer += tail;
      }

      if (kind === "gemini") {
        try {
          const data = JSON.parse(stdoutBuffer);
          if (data.response) emit({ type: "text", content: String(data.response) });
          if (data.error) { emit({ type: "error", content: String(data.error) }); isError = true; }
          // Prefer the CLI's own session id; otherwise mark the session as
          // started with a per-session marker (externalId is unique).
          externalId = data.session_id || externalId || markerFor("gemini", session.id);
          emit({ type: "result", content: data.response || "", costUsd: 0, isError });
        } catch {
          if (stdoutBuffer.trim()) emit({ type: "text", content: stdoutBuffer.trim() });
          emit({ type: "result", content: "", costUsd: 0, isError });
        }
      } else if (kind === "plain") {
        // Mark the session started so follow-up turns can continue it (opencode).
        externalId = externalId || markerFor(session.provider, session.id);
        emit({ type: "result", content: "", costUsd: 0, isError });
      } else if (pi) {
        if (stdoutBuffer.trim()) handleLine(stdoutBuffer);
        const stopped = !!opts.signal?.aborted || signal === "SIGINT" || signal === "SIGTERM" || signal === "SIGKILL" || code === 130 || code === 143;
        // pi exits 0 even when the provider failed; a run that ended without
        // its end-of-run records is reported as an error, not as success. A
        // crash (non-zero exit) is reported before the turn's result so the
        // result never claims success.
        if (!stopped && !isError && (code !== 0 || !pi.mapper.sawEnd)) {
          routePi(pi.mapper.incomplete(stderr.trim().slice(-2000) || (code !== 0 ? `${bin} exited with code ${code}` : "")));
        }
        routePi(pi.mapper.finish({ stopped }));
        if (stopped && code === 0 && !isError) {
          isError = true;
          emitNow({ type: "error", content: "Gestoppt." });
        }
      } else if (stdoutBuffer.trim()) {
        handleClaudeLine(stdoutBuffer);
      }
      flushPending();

      // `--resume` of a conversation that is gone: no output at all — runTurn
      // reports it and starts a new conversation instead of failing the turn.
      if (kind === "claude" && code !== 0 && !sawInit && session.externalId && !opts.signal?.aborted && RESUME_MISSING.test(stderr)) {
        resolve({ externalId: null, costUsd: 0, isError: true, resumeMissing: true });
        return;
      }

      if (code !== 0 && !isError) {
        isError = true;
        const stopped = opts.signal?.aborted || signal === "SIGINT" || signal === "SIGTERM" || signal === "SIGKILL" || code === 130 || code === 143;
        emit({ type: "error", content: stopped ? "Gestoppt." : (stderr.trim() || `${bin} exited with code ${code}`) });
      }
      emit({ type: "done" });
      resolve({ externalId, costUsd, isError });
    });
  });
}
