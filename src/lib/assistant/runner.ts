import { spawn, type ChildProcessWithoutNullStreams } from "child_process";

export interface AssistantSessionRow {
  id: string;
  externalId: string | null;
  provider: string;
  model: string;
  cwd: string;
  permissionMode: string;
  allowedTools: string;
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

function claudeArgs(session: AssistantSessionRow, prompt: string): string[] {
  const args = ["-p", prompt, "--output-format", "stream-json", "--verbose"];
  if (session.externalId) args.push("--resume", session.externalId);
  if (session.model) args.push("--model", session.model);
  args.push("--permission-mode", session.permissionMode || "default");
  const tools = (session.allowedTools || "").trim();
  if (tools) args.push("--allowedTools", tools);
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
  const isGemini = session.provider === "gemini";
  const bin = isGemini ? "gemini" : "claude";
  const args = isGemini ? geminiArgs(session, prompt) : claudeArgs(session, prompt);

  const env: NodeJS.ProcessEnv = { ...process.env };
  if (isGemini && apiKey) {
    env.GEMINI_API_KEY = apiKey;
    env.GOOGLE_API_KEY = apiKey;
  }
  if (!isGemini && apiKey) {
    // Optional: allow overriding Claude auth with an explicit key.
    env.ANTHROPIC_API_KEY = apiKey;
  }

  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(bin, args, { cwd: session.cwd, env });
  } catch (err) {
    emit({ type: "error", content: `Failed to start ${bin}: ${err instanceof Error ? err.message : String(err)}` });
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
      if (isGemini) {
        stdoutBuffer += chunk.toString();
        return; // gemini returns a single JSON object; parse at close
      }
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) handleClaudeLine(line);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      emit({ type: "error", content: err.message });
      isError = true;
    });

    child.on("close", (code) => {
      procs.delete(session.id);

      if (isGemini) {
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
