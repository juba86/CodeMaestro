import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import path from "path";

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
}

const HOOK_PATH = path.join(process.cwd(), "scripts", "assistant-approval-hook.mjs");

// Builds a Claude Code --settings file (PreToolUse approval hook + optional
// sandbox) for this turn. Returns the file path, or null if neither is needed.
function buildSettingsFile(session: AssistantSessionRow): string | null {
  const approval = session.approvalMode && session.approvalMode !== "off";
  if (!approval && !session.sandbox) return null;
  const settings: Record<string, unknown> = {};
  if (approval) {
    const matcher = session.approvalMode === "all" ? "Edit|Write|MultiEdit|Bash" : "Edit|Write|MultiEdit";
    settings.hooks = {
      PreToolUse: [
        { matcher, hooks: [{ type: "command", command: `${process.execPath} ${JSON.stringify(HOOK_PATH).slice(1, -1)}`, timeout: 320 }] },
      ],
    };
  }
  if (session.sandbox) {
    settings.sandbox = { enabled: true };
  }
  const file = path.join(tmpdir(), `pb-settings-${session.id}-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(settings));
  return file;
}

export interface NormalizedEvent {
  type: "init" | "text" | "thinking" | "tool_use" | "tool_result" | "result" | "error" | "done";
  content?: string;
  name?: string;
  input?: unknown;
  toolUseId?: string;
  isError?: boolean;
  sessionId?: string;
  model?: string;
  costUsd?: number;
}

export interface TurnResult {
  externalId: string | null;
  costUsd: number;
  isError: boolean;
}

// One active child per session id, so the stop endpoint can terminate it.
const procs = new Map<string, ChildProcessWithoutNullStreams>();

export function stopSession(sessionId: string): boolean {
  const p = procs.get(sessionId);
  if (p) {
    p.kill("SIGTERM");
    return true;
  }
  return false;
}

export function isRunning(sessionId: string): boolean {
  return procs.has(sessionId);
}

function claudeArgs(session: AssistantSessionRow, prompt: string, settingsFile: string | null): string[] {
  const args = ["-p", prompt, "--output-format", "stream-json", "--verbose"];
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

function geminiArgs(session: AssistantSessionRow, prompt: string): string[] {
  const args = ["-p", prompt, "--output-format", "json", "--skip-trust"];
  if (session.model) args.push("--model", session.model);
  args.push("--approval-mode", geminiApproval(session.permissionMode || "default"));
  const tools = (session.allowedTools || "").trim();
  if (tools) args.push("--allowed-tools", tools);
  // gemini resumes by index/"latest" (not UUID). Once this session has run once,
  // continue the most recent session in this working directory.
  if (session.externalId) args.push("--resume", "latest");
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
  message?: { content?: Array<{ type: string; text?: string; thinking?: string; name?: string; input?: unknown; id?: string; tool_use_id?: string; content?: unknown; is_error?: boolean }> };
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
  emit: (e: NormalizedEvent) => void
): Promise<TurnResult> {
  const plain = isPlainAgent(session.provider);
  const isGemini = session.provider === "gemini";
  const kind: "claude" | "gemini" | "plain" = plain ? "plain" : isGemini ? "gemini" : "claude";

  // Approval hook + sandbox are Claude-Code-specific (PreToolUse settings).
  const settingsFile = kind === "claude" ? buildSettingsFile(session) : null;
  const bin = plain ? PLAIN_AGENTS[session.provider].bin : isGemini ? "gemini" : "claude";
  const args = plain
    ? plainArgs(session.provider, session, prompt)
    : isGemini
      ? geminiArgs(session, prompt)
      : claudeArgs(session, prompt, settingsFile);

  const env: NodeJS.ProcessEnv = { ...process.env };
  if (isGemini && apiKey) {
    env.GEMINI_API_KEY = apiKey;
    env.GOOGLE_API_KEY = apiKey;
  }
  if (kind === "claude" && apiKey) {
    // Optional: allow overriding Claude auth with an explicit key.
    env.ANTHROPIC_API_KEY = apiKey;
  }
  // The approval hook (a child of claude) calls back into this server.
  if (settingsFile) {
    const host = process.env.HOSTNAME || "127.0.0.1";
    const port = process.env.PORT || "3000";
    env.PB_BASE_URL = `http://${host}:${port}`;
    env.PB_SESSION_ID = session.id;
  }

  const installHint = plain ? ` (nicht installiert? ${PLAIN_AGENTS[session.provider].install})` : "";

  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(bin, args, { cwd: session.cwd, env });
  } catch (err) {
    emit({ type: "error", content: `Failed to start ${bin}: ${err instanceof Error ? err.message : String(err)}${installHint}` });
    return { externalId: session.externalId, costUsd: 0, isError: true };
  }

  procs.set(session.id, child);

  let externalId = session.externalId;
  let costUsd = 0;
  let isError = false;
  let stdoutBuffer = "";
  let stderr = "";

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
      emit({ type: "init", sessionId: obj.session_id, model: obj.model });
      return;
    }
    if (obj.type === "assistant" && obj.message?.content) {
      for (const block of obj.message.content) {
        if (block.type === "text" && block.text) {
          emit({ type: "text", content: block.text });
        } else if (block.type === "thinking" && block.thinking) {
          emit({ type: "thinking", content: block.thinking });
        } else if (block.type === "tool_use") {
          emit({ type: "tool_use", name: block.name, input: block.input, toolUseId: block.id });
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
          emit({ type: "tool_result", toolUseId: block.tool_use_id, content: c, isError: block.is_error });
        }
      }
      return;
    }
    if (obj.type === "result") {
      if (obj.session_id) externalId = obj.session_id;
      if (typeof obj.total_cost_usd === "number") costUsd = obj.total_cost_usd;
      isError = !!obj.is_error;
      emit({ type: "result", content: obj.result, costUsd, isError });
    }
  };

  return await new Promise<TurnResult>((resolve) => {
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
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
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      const enoent = (err as NodeJS.ErrnoException).code === "ENOENT";
      emit({ type: "error", content: enoent ? `${bin} nicht gefunden${installHint}` : err.message });
      isError = true;
    });

    child.on("close", (code) => {
      procs.delete(session.id);
      if (settingsFile) { try { unlinkSync(settingsFile); } catch { /* ignore */ } }

      if (kind === "gemini") {
        try {
          const data = JSON.parse(stdoutBuffer);
          if (data.response) emit({ type: "text", content: String(data.response) });
          if (data.error) { emit({ type: "error", content: String(data.error) }); isError = true; }
          // gemini resumes by "latest"/index, not UUID — mark the session so the
          // next turn passes --resume latest.
          externalId = data.session_id || externalId || "latest";
          emit({ type: "result", content: data.response || "", costUsd: 0, isError });
        } catch {
          if (stdoutBuffer.trim()) emit({ type: "text", content: stdoutBuffer.trim() });
          emit({ type: "result", content: "", costUsd: 0, isError });
        }
      } else if (kind === "plain") {
        // Mark the session started so follow-up turns can continue it (opencode).
        externalId = externalId || session.provider;
        emit({ type: "result", content: "", costUsd: 0, isError });
      } else if (stdoutBuffer.trim()) {
        handleClaudeLine(stdoutBuffer);
      }

      if (code !== 0 && !isError) {
        isError = true;
        emit({ type: "error", content: stderr.trim() || `${bin} exited with code ${code}` });
      }
      emit({ type: "done" });
      resolve({ externalId, costUsd, isError });
    });
  });
}
