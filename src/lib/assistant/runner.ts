import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { StringDecoder } from "string_decoder";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { approvalTimeoutMs, hookToken } from "./approvals";
import { GITHUB_SANDBOX_DOMAINS, githubEnv } from "@/lib/github";

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
  // When true (live PWA turns), install a PreToolUse hook for Claude's interactive
  // tools (AskUserQuestion / ExitPlanMode) so the UI can surface clickable options.
  // Left off for orchestrator/Telegram turns that have no question UI.
  interactive?: boolean;
}

const HOOK_PATH = path.join(process.cwd(), "scripts", "assistant-approval-hook.mjs");

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

export interface NormalizedEvent {
  type: "init" | "text" | "thinking" | "tool_use" | "tool_result" | "result" | "error" | "done" | "knowledge";
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

// SIGINT first: Claude Code ends an interrupted turn cleanly on SIGINT, while
// SIGTERM (exit 143) leaves the turn unfinished in its session transcript.
// Escalate if the process group doesn't exit.
function terminate(child: ChildProcessWithoutNullStreams) {
  killTree(child, "SIGINT");
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
 * Providers whose approval gate / sandbox CodeMaestro can enforce (through
 * Claude Code's PreToolUse hook + settings). Others run their tools directly.
 */
export function supportsApprovalGate(provider: string): boolean {
  return provider === "claude";
}

function claudeArgs(session: AssistantSessionRow, prompt: string, settingsFile: string | null): string[] {
  // --include-partial-messages streams text token by token (stream_event).
  const args = ["-p", prompt, "--output-format", "stream-json", "--verbose", "--include-partial-messages"];
  if (session.externalId) args.push("--resume", session.externalId);
  if (session.model) args.push("--model", session.model);
  args.push("--permission-mode", session.permissionMode || "default");
  const tools = (session.allowedTools || "").trim();
  if (tools) args.push("--allowedTools", tools);
  if (settingsFile) args.push("--settings", settingsFile);
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
    for (const g of GEMINI_TOOL_NAMES[t] ?? [t]) out.add(g);
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
  return provider in PLAIN_AGENTS;
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
}

/**
 * Runs one assistant turn by spawning the CLI, parsing its stream-json/json
 * output, and invoking `emit` for each normalized event. Resolves when the
 * process exits. The child is registered in `procs` so it can be stopped.
 */
export async function runTurn(
  session: AssistantSessionRow,
  prompt: string,
  apiKey: string | undefined,
  emit: (e: NormalizedEvent) => void,
  opts: { signal?: AbortSignal } = {}
): Promise<TurnResult> {
  const plain = isPlainAgent(session.provider);
  const isGemini = session.provider === "gemini";
  const kind: "claude" | "gemini" | "plain" = plain ? "plain" : isGemini ? "gemini" : "claude";

  // Connected GitHub account (Settings → GitHub): token + git credential
  // helper for every provider, so the agent can push and use gh. Empty when
  // not connected or disabled; never throws. Awaited before the abort check so
  // nothing async sits between that check and spawn + abort-listener setup.
  const ghEnv = await githubEnv();
  const github = Object.keys(ghEnv).length > 0;

  if (opts.signal?.aborted) {
    return { externalId: session.externalId, costUsd: 0, isError: true };
  }

  // Fail closed: never run a provider without the approval gate the session
  // asked for (only Claude Code's hooks can enforce it today).
  if (session.approvalMode && session.approvalMode !== "off" && !supportsApprovalGate(session.provider)) {
    emit({
      type: "error",
      content: "Das Freigabe-Gate wird für diesen Provider nicht unterstützt. Bitte eine Session ohne Freigabe-Modus anlegen oder Claude Code verwenden.",
    });
    emit({ type: "done" });
    return { externalId: session.externalId, costUsd: 0, isError: true };
  }

  // Approval hook + sandbox are Claude-Code-specific (PreToolUse settings).
  let settingsFile: string | null = null;
  if (kind === "claude") {
    try {
      settingsFile = buildSettingsFile(session, { github });
    } catch (err) {
      emit({ type: "error", content: err instanceof Error ? err.message : String(err) });
      emit({ type: "done" });
      return { externalId: session.externalId, costUsd: 0, isError: true };
    }
  }
  const bin = plain ? PLAIN_AGENTS[session.provider].bin : isGemini ? "gemini" : "claude";
  const args = plain
    ? plainArgs(session.provider, session, prompt)
    : isGemini
      ? geminiArgs(session, prompt)
      : claudeArgs(session, prompt, settingsFile);

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
  if (settingsFile) {
    env.PB_BASE_URL = internalBaseUrl();
    env.PB_SESSION_ID = session.id;
    env.PB_HOOK_TOKEN = hookToken();
    env.PB_APPROVAL_TIMEOUT_MS = String(approvalTimeoutMs());
  }

  const installHint = plain ? ` (nicht installiert? ${PLAIN_AGENTS[session.provider].install})` : "";

  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(bin, args, { cwd: session.cwd, env, detached: process.platform !== "win32" });
  } catch (err) {
    if (settingsFile) { try { unlinkSync(settingsFile); } catch { /* ignore */ } }
    emit({ type: "error", content: `Failed to start ${bin}: ${err instanceof Error ? err.message : String(err)}${installHint}` });
    return { externalId: session.externalId, costUsd: 0, isError: true };
  }

  // The prompt is passed as an argument; close stdin so no CLI waits for
  // piped input.
  child.stdin.end();

  trackProc(session.id, child);
  const onAbort = () => terminate(child);
  opts.signal?.addEventListener("abort", onAbort, { once: true });

  let externalId = session.externalId;
  let costUsd = 0;
  let isError = false;
  let stdoutBuffer = "";
  let stderr = "";
  // Decode UTF-8 across chunk boundaries (a multi-byte character can be split).
  const outDecoder = new StringDecoder("utf8");
  const errDecoder = new StringDecoder("utf8");

  // Token deltas are coalesced (~80 ms) so a long answer doesn't flood the run
  // buffer with one event per token; anything else flushes pending text first.
  let pending: { type: "text" | "thinking"; content: string } | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const flushPending = () => {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (pending) { const p = pending; pending = null; emit({ type: p.type, content: p.content }); }
  };
  const emitDelta = (type: "text" | "thinking", content: string) => {
    if (pending && pending.type !== type) flushPending();
    pending = pending ? { type, content: pending.content + content } : { type, content };
    if (pending.content.length >= 2000) flushPending();
    else if (!flushTimer) flushTimer = setTimeout(flushPending, 80);
  };
  const emitNow = (e: NormalizedEvent) => { flushPending(); emit(e); };

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
      emitNow({ type: "result", content: obj.result, costUsd, isError });
    }
  };

  return await new Promise<TurnResult>((resolve) => {
    child.stdout.on("data", (chunk: Buffer) => {
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
      for (const line of lines) handleClaudeLine(line);
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
      untrackProc(session.id, child);
      opts.signal?.removeEventListener("abort", onAbort);
      if (settingsFile) { try { unlinkSync(settingsFile); } catch { /* ignore */ } }
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
      } else if (stdoutBuffer.trim()) {
        handleClaudeLine(stdoutBuffer);
      }
      flushPending();

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
