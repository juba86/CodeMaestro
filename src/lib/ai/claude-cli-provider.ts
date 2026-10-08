import { spawn } from "child_process";
import { tmpdir } from "os";
import type { AIProvider, SendMessageParams, StreamChunk, ModelInfo } from "./types";

// Curated model list for login/CLI mode. Empty id = Claude Code's default model.
// The CLI accepts the short aliases (always the latest model of that line) as
// well as full model ids — the pinned ids below are the current generation.
export function claudeCliModels(): ModelInfo[] {
  return [
    { id: "", name: "Standard (CLI-Default)", provider: "claude", maxTokens: 128000 },
    { id: "opus", name: "Claude Opus (neueste)", provider: "claude", maxTokens: 128000 },
    { id: "sonnet", name: "Claude Sonnet (neueste)", provider: "claude", maxTokens: 128000 },
    { id: "haiku", name: "Claude Haiku (neueste)", provider: "claude", maxTokens: 128000 },
    { id: "fable", name: "Claude Fable (neueste)", provider: "claude", maxTokens: 128000 },
    { id: "claude-opus-5-5", name: "Claude Opus 5.5", provider: "claude", maxTokens: 128000 },
    { id: "claude-fable-5-1", name: "Claude Fable 5.1", provider: "claude", maxTokens: 128000 },
    { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", provider: "claude", maxTokens: 128000 },
    { id: "claude-haiku-5-5", name: "Claude Haiku 5.5", provider: "claude", maxTokens: 128000 },
  ];
}

function extractJson(s: string): string {
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  return start >= 0 && end > start ? s.slice(start, end + 1) : s;
}

function buildPrompt(params: SendMessageParams): string {
  const parts: string[] = [];
  if (params.systemPrompt) parts.push(params.systemPrompt);
  for (const m of params.messages) {
    parts.push(m.role === "system" ? m.content : `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`);
  }
  return parts.join("\n\n");
}

/**
 * Claude provider that uses the locally logged-in Claude Code CLI (`claude -p`)
 * instead of an API key. Requires `claude` on PATH and a completed login
 * (subscription or `claude` setup in ~/.claude). Runs in a temp dir with
 * file-mutating tools disabled — this is a plain text generation path.
 */
export class ClaudeCliProvider implements AIProvider {
  name = "claude" as const;

  getModels(): ModelInfo[] {
    return claudeCliModels();
  }

  private run(prompt: string, model?: string, timeoutMs = 240000): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = [
        "-p", prompt,
        "--output-format", "json",
        "--disallowedTools", "Bash,Edit,Write,NotebookEdit,Task",
      ];
      if (model) args.push("--model", model);
      const child = spawn("claude", args, { cwd: tmpdir(), env: { ...process.env } });
      let out = "";
      let err = "";
      const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("claude-cli timed out")); }, timeoutMs);
      child.stdout.on("data", (c: Buffer) => { out += c.toString(); });
      child.stderr.on("data", (c: Buffer) => { err += c.toString(); });
      child.on("error", (e) => { clearTimeout(timer); reject(e); });
      child.on("close", (code) => {
        clearTimeout(timer);
        try {
          const data = JSON.parse(extractJson(out)) as { result?: string; is_error?: boolean };
          if (data.is_error) { reject(new Error(data.result || "claude-cli error")); return; }
          resolve(data.result || "");
        } catch {
          if (code !== 0) reject(new Error(err.trim() || `claude-cli exited with code ${code}`));
          else resolve(out.trim());
        }
      });
    });
  }

  async sendMessage(params: SendMessageParams): Promise<string> {
    return this.run(buildPrompt(params), params.model || undefined);
  }

  async *streamMessage(params: SendMessageParams): AsyncGenerator<StreamChunk> {
    try {
      const text = await this.run(buildPrompt(params), params.model || undefined);
      if (text) yield { type: "text", content: text };
    } catch (err) {
      yield { type: "error", content: err instanceof Error ? err.message : "claude-cli failed" };
    }
    yield { type: "done", content: "" };
  }

  // No API key involved (CLI login): valid when the CLI answers.
  async validateCredentials(): Promise<boolean> {
    try {
      const text = await this.run("Reply with: OK", undefined, 60000);
      return text.length > 0;
    } catch {
      return false;
    }
  }
}
