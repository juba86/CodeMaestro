import { afterEach, describe, expect, it, vi } from "vitest";
import { handleMessage, toPermissionResult } from "./assistant-permission-mcp.mjs";

const ENV = { PB_BASE_URL: "http://cm.test", PB_SESSION_ID: "s1", PB_HOOK_TOKEN: "tok", PB_APPROVAL_TIMEOUT_MS: "60000" } as unknown as NodeJS.ProcessEnv;

function stubServer(decide: (tool: string, input: unknown) => { decision: string; reason?: string }) {
  const calls: Array<{ url: string; body?: unknown; token?: string }> = [];
  let pending: { tool: string; input: unknown } | null = null;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body, token: headers["x-codemaestro-hook-token"] });
    if (url.endsWith("/api/assistant/approval/request")) {
      pending = { tool: body.tool, input: body.input };
      return new Response(JSON.stringify({ approvalId: "apr_1" }));
    }
    const d = decide(pending!.tool, pending!.input);
    return new Response(JSON.stringify({ status: "decided", ...d }));
  }));
  return calls;
}

const call = (args: Record<string, unknown>) =>
  handleMessage({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "permission", arguments: args } }, ENV);

const payload = (res: unknown) => JSON.parse((res as { result: { content: Array<{ text: string }> } }).result.content[0].text);

afterEach(() => vi.unstubAllGlobals());

describe("permission-prompt MCP server", () => {
  it("speaks the MCP handshake and lists one tool", async () => {
    const init = await handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, ENV);
    expect(init).toMatchObject({ id: 1, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} } } });
    expect(await handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, ENV)).toBeNull();
    const list = await handleMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" }, ENV);
    expect((list as { result: { tools: Array<{ name: string }> } }).result.tools.map((t) => t.name)).toEqual(["permission"]);
    const unknown = await handleMessage({ jsonrpc: "2.0", id: 3, method: "resources/list" }, ENV);
    expect(unknown).toMatchObject({ id: 3, error: { code: -32601 } });
  });

  it("turns an approved command into allow with the original input", async () => {
    const calls = stubServer(() => ({ decision: "allow" }));
    const res = await call({ tool_name: "Bash", input: { command: "npm install" }, tool_use_id: "tu_1" });
    expect(payload(res)).toEqual({ behavior: "allow", updatedInput: { command: "npm install" } });
    expect(calls[0]).toMatchObject({ body: { sessionId: "s1", tool: "Bash", input: { command: "npm install" } }, token: "tok" });
    expect(calls[1].url).toContain("/api/assistant/approval/apr_1/wait");
  });

  it("passes the user's answers to a question back as the message", async () => {
    stubServer(() => ({ decision: "deny", reason: "Der Nutzer hat geantwortet:\n- Datenbank: B" }));
    const res = await call({ tool_name: "AskUserQuestion", input: { questions: [{ question: "Datenbank?", options: [{ label: "A" }, { label: "B" }] }] } });
    expect(payload(res)).toEqual({ behavior: "deny", message: "Der Nutzer hat geantwortet:\n- Datenbank: B" });
  });

  it("fails closed when the server is unreachable or unconfigured", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    expect(payload(await call({ tool_name: "Bash", input: { command: "ls" } })).behavior).toBe("deny");
    const res = await handleMessage(
      { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "permission", arguments: { tool_name: "Bash", input: {} } } },
      {} as NodeJS.ProcessEnv
    );
    expect(payload(res)).toEqual({ behavior: "deny", message: "Freigabe-Bridge nicht konfiguriert." });
  });

  it("rejects other tool names and keeps a fallback message for empty denials", async () => {
    const res = await handleMessage({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "other", arguments: {} } }, ENV);
    expect(res).toMatchObject({ error: { code: -32602 } });
    expect(toPermissionResult("Bash", {}, { decision: "deny" })).toEqual({ behavior: "deny", message: "Vom Nutzer abgelehnt." });
    expect(toPermissionResult("AskUserQuestion", {}, { decision: "deny", reason: "  " }).message).toBe("Der Nutzer hat nicht geantwortet.");
  });
});
