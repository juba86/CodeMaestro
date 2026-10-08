#!/usr/bin/env node
// Claude Code permission-prompt tool for headless runs (`claude -p`).
//
// Without a permission host, `claude -p` silently denies every tool call that
// would need a permission prompt (a Bash command outside allowedTools, …) and
// does not even offer AskUserQuestion / ExitPlanMode — Claude then asks in
// plain text ("Ich warte auf die Freigabe …", "A, B oder C?") and nobody can
// answer. Passing this stdio MCP server via --mcp-config together with
// `--permission-prompt-tool mcp__codemaestro__permission` turns those prompts
// into approval/question cards in the PWA and Telegram (same bridge as the
// PreToolUse hook: create + long-poll on the CodeMaestro server).
//
// Protocol: newline-delimited JSON-RPC 2.0 (MCP stdio transport). The tool
// returns a JSON text payload: {"behavior":"allow","updatedInput":{…}} or
// {"behavior":"deny","message":"…"}.
//
// Fails closed: any error answers "deny".
//
// Env: PB_BASE_URL, PB_SESSION_ID, PB_HOOK_TOKEN, PB_APPROVAL_TIMEOUT_MS
//      (as for scripts/assistant-approval-hook.mjs).

import readline from "readline";
import { pathToFileURL } from "url";

export const TOOL_NAME = "permission";

const TOOL = {
  name: TOOL_NAME,
  description: "Asks the CodeMaestro user to approve a tool call or answer a question.",
  inputSchema: {
    type: "object",
    properties: {
      tool_name: { type: "string", description: "The tool that needs permission" },
      input: { type: "object", description: "The tool's input" },
      tool_use_id: { type: "string" },
    },
    required: ["tool_name", "input"],
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(url, init, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/**
 * Asks the server for a decision on `tool` with `input`. Resolves to
 * { decision: "allow" | "deny", reason? } — never throws.
 */
export async function askServer(tool, input, env = process.env) {
  const base = env.PB_BASE_URL;
  const sessionId = env.PB_SESSION_ID;
  if (!base || !sessionId) return { decision: "deny", reason: "Freigabe-Bridge nicht konfiguriert." };
  const headers = { "Content-Type": "application/json", "x-codemaestro-hook-token": env.PB_HOOK_TOKEN || "" };
  const overall = Number(env.PB_APPROVAL_TIMEOUT_MS) || 1_800_000;
  const deadline = Date.now() + overall + 30_000;

  let created;
  try {
    created = await call(`${base}/api/assistant/approval/request`, {
      method: "POST",
      headers,
      body: JSON.stringify({ sessionId, tool, input }),
    }, 30_000);
  } catch (e) {
    return { decision: "deny", reason: "Freigabe-Bridge nicht erreichbar: " + (e?.message || e) };
  }
  if (created?.decision) return { decision: created.decision === "allow" ? "allow" : "deny", reason: created.reason };
  const approvalId = created?.approvalId;
  if (!approvalId) return { decision: "deny", reason: "Freigabe-Bridge: keine Freigabe-ID erhalten." };

  let failures = 0;
  while (Date.now() < deadline) {
    try {
      const r = await call(
        `${base}/api/assistant/approval/${encodeURIComponent(approvalId)}/wait?timeout=25`,
        { headers },
        40_000
      );
      failures = 0;
      if (r?.status === "decided") return { decision: r.decision === "allow" ? "allow" : "deny", reason: r.reason };
      if (r?.status !== "pending") return { decision: "deny", reason: "Freigabe abgelaufen." };
    } catch {
      if (++failures >= 5) return { decision: "deny", reason: "Freigabe-Bridge nicht erreichbar." };
      await sleep(2000);
    }
  }
  return { decision: "deny", reason: "Freigabe-Timeout." };
}

/**
 * The permission tool's answer for a decision. A question (AskUserQuestion) is
 * answered the same way as through the PreToolUse hook: "deny" with the user's
 * answers as the message, which Claude reads as the tool result.
 */
export function toPermissionResult(tool, input, d) {
  if (d.decision === "allow") return { behavior: "allow", updatedInput: input && typeof input === "object" ? input : {} };
  const fallback = tool === "AskUserQuestion" ? "Der Nutzer hat nicht geantwortet." : "Vom Nutzer abgelehnt.";
  return { behavior: "deny", message: (d.reason && String(d.reason).trim()) || fallback };
}

export async function handleToolCall(params, env = process.env) {
  const args = params?.arguments ?? {};
  const tool = typeof args.tool_name === "string" ? args.tool_name : "";
  const input = args.input && typeof args.input === "object" ? args.input : {};
  const result = !tool
    ? { behavior: "deny", message: "Freigabe-Bridge: unbekanntes Werkzeug." }
    : toPermissionResult(tool, input, await askServer(tool, input, env));
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
}

/** Handles one JSON-RPC message; returns the response object or null (notification). */
export async function handleMessage(msg, env = process.env) {
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0") return null;
  const { id, method, params } = msg;
  if (id === undefined || id === null) return null; // notification (e.g. notifications/initialized)
  const ok = (result) => ({ jsonrpc: "2.0", id, result });
  switch (method) {
    case "initialize":
      return ok({
        protocolVersion: typeof params?.protocolVersion === "string" ? params.protocolVersion : "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "codemaestro", version: "1.0.0" },
      });
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: [TOOL] });
    case "tools/call":
      if (params?.name !== TOOL_NAME) {
        return { jsonrpc: "2.0", id, error: { code: -32602, message: `Unknown tool: ${params?.name}` } };
      }
      try {
        return ok(await handleToolCall(params, env));
      } catch (e) {
        const denied = { behavior: "deny", message: "Freigabe-Bridge-Fehler: " + (e?.message || e) };
        return ok({ content: [{ type: "text", text: JSON.stringify(denied) }] });
      }
    default:
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
  }
}

function serve() {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  const send = (o) => process.stdout.write(JSON.stringify(o) + "\n");
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }
    // Calls run concurrently: Claude may ask about several tool calls at once.
    handleMessage(msg)
      .then((res) => { if (res) send(res); })
      .catch((e) => process.stderr.write(`Permission-MCP-Fehler: ${e?.message || e}\n`));
  });
  rl.on("close", () => process.exit(0));
}

// Run as a server unless imported (tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) serve();
