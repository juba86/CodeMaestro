import { spawn } from "child_process";
import type { AIProvider, SendMessageParams, StreamChunk, ModelInfo } from "./types";

// Curated model list for OAuth/CLI mode. The empty id means "use the gemini-cli
// default model". Concrete ids are passed via -m.
export function geminiCliModels(): ModelInfo[] {
  return [
    { id: "", name: "Standard (CLI-Default)", provider: "gemini", maxTokens: 65536 },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", provider: "gemini", maxTokens: 65536 },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "gemini", maxTokens: 65536 },
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
 * Gemini provider that uses the locally OAuth-logged-in gemini-cli instead of an
 * API key. Requires `gemini` on PATH and a completed Google login (~/.gemini).
 */
export class GeminiCliProvider implements AIProvider {
  name = "gemini" as const;

  // No key required; constructor kept for factory compatibility.
  constructor(_apiKey?: string) {}

  getModels(): ModelInfo[] {
    return geminiCliModels();
  }

  private run(prompt: string, model?: string, timeoutMs = 240000): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = ["-p", prompt, "-o", "json", "--skip-trust", "--approval-mode", "plan"];
      if (model) args.push("-m", model);
      const child = spawn("gemini", args, { env: { ...process.env } });
      let out = "";
      let err = "";
      const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("gemini-cli timed out")); }, timeoutMs);
      child.stdout.on("data", (c: Buffer) => { out += c.toString(); });
      child.stderr.on("data", (c: Buffer) => { err += c.toString(); });
      child.on("error", (e) => { clearTimeout(timer); reject(e); });
      child.on("close", (code) => {
        clearTimeout(timer);
        try {
          const data = JSON.parse(extractJson(out)) as { response?: string; error?: { message?: string } | string };
          if (data.error) {
            const msg = typeof data.error === "string" ? data.error : data.error.message || "gemini-cli error";
            reject(new Error(msg));
            return;
          }
          resolve(data.response || "");
        } catch {
          if (code !== 0) reject(new Error(err.trim() || `gemini-cli exited with code ${code}`));
          else resolve(out.trim());
        }
      });
    });
  }

  async sendMessage(params: SendMessageParams): Promise<string> {
    return this.run(buildPrompt(params), params.model || undefined);
  }

  async *streamMessage(params: SendMessageParams): AsyncGenerator<StreamChunk> {
    // gemini-cli -p is single-shot; emit the full response as one chunk.
    try {
      const text = await this.run(buildPrompt(params), params.model || undefined);
      if (text) yield { type: "text", content: text };
    } catch (err) {
      yield { type: "error", content: err instanceof Error ? err.message : "gemini-cli failed" };
    }
    yield { type: "done", content: "" };
  }

  async validateCredentials(_apiKey: string): Promise<boolean> {
    try {
      const text = await this.run("Reply with: OK", undefined, 60000);
      return text.length > 0;
    } catch {
      return false;
    }
  }
}
