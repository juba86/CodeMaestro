import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

vi.mock("@/lib/github", () => ({ githubEnv: vi.fn(async () => ({})), GITHUB_SANDBOX_DOMAINS: [] }));

import { PERMISSION_PROMPT_TOOL, denialNotice, describeDenials, runTurn, isRunning, isPlainAgent, mapToolsForGemini, stopSession, type AssistantSessionRow, type NormalizedEvent } from "./runner";

// A stand-in `claude` binary on PATH that replays a scripted stream-json run.
const binDir = mkdtempSync(path.join(tmpdir(), "cm-fake-claude-"));
const workDir = mkdtempSync(path.join(tmpdir(), "cm-work-"));
const oldPath = process.env.PATH;

const FAKE = `#!/usr/bin/env node
const fs = require("fs");
const mode = process.env.FAKE_MODE || "stream";
const argv = process.argv.slice(2);
const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
if (mode === "argv") {
  // Record the arguments and the --mcp-config / --settings files as seen during the run.
  const i = argv.indexOf("--mcp-config");
  const mcp = i >= 0 ? JSON.parse(fs.readFileSync(argv[i + 1], "utf8")) : null;
  const j = argv.indexOf("--settings");
  const settings = j >= 0 ? JSON.parse(fs.readFileSync(argv[j + 1], "utf8")) : null;
  fs.writeFileSync(process.env.FAKE_ARGV, JSON.stringify({ argv, mcp, settings, timeout: process.env.MCP_TOOL_TIMEOUT }));
  out({ type: "system", subtype: "init", session_id: "s-argv", model: "m" });
  out({ type: "result", result: "ok", total_cost_usd: 0, is_error: false, session_id: "s-argv" });
} else if (mode === "missing" && argv.includes("--resume")) {
  process.stderr.write("No conversation found with session ID: " + argv[argv.indexOf("--resume") + 1] + "\\n");
  process.exit(1);
} else if (mode === "denied") {
  out({ type: "system", subtype: "init", session_id: "s-d", model: "m" });
  out({ type: "result", result: "Ich warte auf die Freigabe.", total_cost_usd: 0, is_error: false, session_id: "s-d",
    permission_denials: [{ tool_name: "Bash", tool_use_id: "t", tool_input: { command: "npm install" } }, { tool_name: "Bash", tool_use_id: "u", tool_input: { command: "npm install" } }] });
} else if (mode === "twomsg") {
  // Consecutive assistant messages with text and nothing in between.
  out({ type: "system", subtype: "init", session_id: "s-2m", model: "m" });
  out({ type: "stream_event", event: { type: "message_start", message: { id: "msg_a" } } });
  out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Erledigt." } } });
  out({ type: "assistant", message: { id: "msg_a", content: [{ type: "text", text: "Erledigt." }] } });
  out({ type: "stream_event", event: { type: "message_start", message: { id: "msg_b" } } });
  out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Jetzt " } } });
  out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "weiter.\\n\\n" } } });
  out({ type: "assistant", message: { id: "msg_b", content: [{ type: "text", text: "Jetzt weiter.\\n\\n" }] } });
  // Already ends in a blank line: nothing added. Final-only message (no deltas).
  out({ type: "assistant", message: { id: "msg_c", content: [{ type: "text", text: "Ende." }] } });
  // Thinking in between: a new block anyway, no break.
  out({ type: "assistant", message: { id: "msg_d", content: [{ type: "thinking", thinking: "hm" }, { type: "text", text: "Nachtrag." }] } });
  out({ type: "result", result: "Nachtrag.", total_cost_usd: 0, is_error: false, session_id: "s-2m" });
} else if (mode === "plandenied") {
  out({ type: "system", subtype: "init", session_id: "s-p", model: "m" });
  out({ type: "result", result: "Plan steht.", total_cost_usd: 0, is_error: false, session_id: "s-p",
    permission_denials: [{ tool_name: "Bash", tool_input: { command: "npm test" } }, { tool_name: "ExitPlanMode", tool_input: { plan: "x" } }] });
} else if (mode === "hang") {
  out({ type: "system", subtype: "init", session_id: "s-hang", model: "m" });
  process.on("SIGINT", () => process.exit(130));
  setInterval(() => {}, 1000);
} else {
  out({ type: "system", subtype: "init", session_id: "s-1", model: "claude-opus-5-5" });
  out({ type: "stream_event", event: { type: "message_start", message: { id: "msg_1" } } });
  for (const t of ["Hal", "lo ", "Wélt"]) out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: t } } });
  out({ type: "assistant", message: { id: "msg_1", content: [{ type: "text", text: "Hallo Wélt" }] } });
  out({ type: "assistant", message: { id: "msg_1", content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "a" } }] } });
  out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "body" }] } });
  // A message without partial deltas (e.g. a subagent) is emitted from the final event.
  out({ type: "assistant", message: { id: "msg_2", content: [{ type: "text", text: "Fertig." }] } });
  // Emit the result line in two writes, split inside a multi-byte character.
  const line = Buffer.from(JSON.stringify({ type: "result", result: "Fertig ✓", total_cost_usd: 0.02, is_error: false, session_id: "s-1" }) + "\\n");
  const cut = line.indexOf(Buffer.from("✓")) + 1;
  process.stdout.write(line.subarray(0, cut));
  setTimeout(() => process.stdout.write(line.subarray(cut)), 20);
}
`;

beforeAll(() => {
  const bin = path.join(binDir, "claude");
  writeFileSync(bin, FAKE);
  chmodSync(bin, 0o755);
  process.env.PATH = `${binDir}${path.delimiter}${oldPath}`;
});
afterAll(() => {
  process.env.PATH = oldPath;
  delete process.env.FAKE_MODE;
  delete process.env.FAKE_ARGV;
});

function row(id: string, extra: Partial<AssistantSessionRow> = {}): AssistantSessionRow {
  return {
    id, externalId: null, provider: "claude", model: "", cwd: workDir,
    permissionMode: "default", allowedTools: "Read", approvalMode: "off", sandbox: false, ...extra,
  };
}

describe("runTurn (claude stream-json)", () => {
  it("separates consecutive text messages with a paragraph break", async () => {
    process.env.FAKE_MODE = "twomsg";
    const events: NormalizedEvent[] = [];
    await runTurn(row("r1b"), "hi", undefined, (e) => events.push(e));
    const text = events.filter((e) => e.type === "text").map((e) => e.content).join("");
    expect(text).toBe("Erledigt.\n\nJetzt weiter.\n\nEnde.Nachtrag.");
  });

  it("streams partial text once, keeps tool order and decodes split UTF-8", async () => {
    process.env.FAKE_MODE = "stream";
    const events: NormalizedEvent[] = [];
    const res = await runTurn(row("r1"), "hi", undefined, (e) => events.push(e));

    expect(res).toEqual({ externalId: "s-1", costUsd: 0.02, isError: false });
    const text = events.filter((e) => e.type === "text").map((e) => e.content).join("");
    expect(text).toBe("Hallo WéltFertig.");
    expect(events.map((e) => e.type)).toEqual(["init", "text", "tool_use", "tool_result", "text", "result", "done"]);
    expect(events.find((e) => e.type === "result")?.content).toBe("Fertig ✓");
  });

  it("refuses to run a provider that cannot enforce the approval gate", async () => {
    const events: NormalizedEvent[] = [];
    const res = await runTurn(row("r2", { provider: "codex", approvalMode: "edits" }), "x", undefined, (e) => events.push(e));
    expect(res.isError).toBe(true);
    expect(events[0]).toMatchObject({ type: "error" });
  });

  it("stops a running CLI via SIGINT and reports it as stopped", async () => {
    process.env.FAKE_MODE = "hang";
    const events: NormalizedEvent[] = [];
    const ac = new AbortController();
    const p = runTurn(row("r3"), "x", undefined, (e) => events.push(e), { signal: ac.signal });
    await vi.waitFor(() => expect(events.some((e) => e.type === "init")).toBe(true));
    expect(isRunning("r3")).toBe(true);
    ac.abort();
    const res = await p;
    expect(res.isError).toBe(true);
    expect(events.some((e) => e.type === "error" && e.content === "Gestoppt.")).toBe(true);
    expect(isRunning("r3")).toBe(false);
    expect(stopSession("r3")).toBe(false);
  });
});

describe("runTurn (claude conversation handling)", () => {
  it("forks the session's conversation and registers the permission-prompt tool for interactive runs", async () => {
    process.env.FAKE_MODE = "argv";
    const file = path.join(workDir, "argv.json");
    process.env.FAKE_ARGV = file;
    const res = await runTurn(
      row("r4", { externalId: "conv-1", forkSession: true, ephemeral: true, interactive: true }),
      "x", undefined, () => {}
    );
    expect(res).toEqual({ externalId: "s-argv", costUsd: 0, isError: false });
    const seen = JSON.parse(readFileSync(file, "utf8"));
    const argv: string[] = seen.argv;
    expect(argv.slice(argv.indexOf("--resume"), argv.indexOf("--resume") + 3)).toEqual(["--resume", "conv-1", "--fork-session"]);
    expect(argv).toContain("--no-session-persistence");
    const mcpAt = argv.indexOf("--mcp-config");
    // The next option ends --mcp-config's value list.
    expect(argv[mcpAt + 2]).toBe("--permission-prompt-tool");
    expect(argv[mcpAt + 3]).toBe(PERMISSION_PROMPT_TOOL);
    expect(seen.mcp.mcpServers.codemaestro.args[0]).toMatch(/assistant-permission-mcp\.mjs$/);
    expect(Object.keys(seen.mcp.mcpServers.codemaestro.env).sort()).toEqual(["PB_APPROVAL_TIMEOUT_MS", "PB_BASE_URL", "PB_HOOK_TOKEN", "PB_SESSION_ID"]);
    expect(Number(seen.timeout)).toBeGreaterThan(30 * 60_000);
    expect(existsSync(argv[mcpAt + 1])).toBe(false); // removed after the run
  });

  it("closes the sandbox's escape hatch (dangerouslyDisableSandbox)", async () => {
    process.env.FAKE_MODE = "argv";
    const file = path.join(workDir, "argv-sandbox.json");
    process.env.FAKE_ARGV = file;
    await runTurn(row("r4b", { sandbox: true, interactive: true }), "x", undefined, () => {});
    const { settings } = JSON.parse(readFileSync(file, "utf8"));
    expect(settings.sandbox).toEqual({ enabled: true, allowUnsandboxedCommands: false });
  });

  it("keeps unattended runs without the permission tool and without forking", async () => {
    process.env.FAKE_MODE = "argv";
    const file = path.join(workDir, "argv2.json");
    process.env.FAKE_ARGV = file;
    await runTurn(row("r5", { externalId: "conv-2" }), "x", undefined, () => {});
    const { argv } = JSON.parse(readFileSync(file, "utf8"));
    expect(argv).toContain("--resume");
    expect(argv).not.toContain("--fork-session");
    expect(argv).not.toContain("--mcp-config");
    expect(argv).not.toContain("--no-session-persistence");
  });

  it("starts a new conversation when the stored one is gone", async () => {
    process.env.FAKE_MODE = "missing";
    const events: NormalizedEvent[] = [];
    const res = await runTurn(row("r6", { externalId: "gone-1234567890" }), "x", undefined, (e) => events.push(e));
    expect(res).toEqual({ externalId: "s-1", costUsd: 0.02, isError: false });
    expect(events[0]).toMatchObject({ type: "notice" });
    expect(events[0].content).toContain("gone-123");
    expect(events.filter((e) => e.type === "error")).toEqual([]);
    expect(events.filter((e) => e.type === "done")).toHaveLength(1);
  });

  it("reports tool calls an unattended run denied", async () => {
    process.env.FAKE_MODE = "denied";
    const events: NormalizedEvent[] = [];
    await runTurn(row("r7"), "x", undefined, (e) => events.push(e));
    const notice = events.find((e) => e.type === "notice");
    expect(notice?.content).toContain("Ohne Freigabe blockiert (1): Bash: npm install");
    // Interactive runs ask instead, so nothing to report there.
    const quiet: NormalizedEvent[] = [];
    await runTurn(row("r8", { interactive: true }), "x", undefined, (e) => quiet.push(e));
    expect(quiet.some((e) => e.type === "notice")).toBe(false);
  });

  it("describes denials compactly", () => {
    expect(describeDenials([{ tool_name: "WebFetch", tool_input: { url: "https://x.dev" } }, { tool_name: "Task" }])).toEqual([
      "WebFetch: https://x.dev",
      "Task",
    ]);
  });

  it("counts a long command denied twice once, and two long commands with the same start twice", () => {
    const long = `cd /repo && ${"npm run build -- --verbose ".repeat(12)}`;
    const twice = describeDenials([{ tool_name: "Bash", tool_input: { command: long } }, { tool_name: "Bash", tool_input: { command: long } }]);
    expect(twice).toHaveLength(1);
    expect(twice[0].length).toBe(200);
    expect(twice[0].endsWith("…")).toBe(true);
    const other = describeDenials([{ tool_name: "Bash", tool_input: { command: long } }, { tool_name: "Bash", tool_input: { command: `${long}x` } }]);
    expect(other).toHaveLength(2);
  });

  it("explains denials of a read-only (plan-mode) run without the useless 'allow the tools' advice", async () => {
    process.env.FAKE_MODE = "plandenied";
    const events: NormalizedEvent[] = [];
    await runTurn(row("r9", { permissionMode: "plan" }), "x", undefined, (e) => events.push(e));
    const notice = events.find((e) => e.type === "notice")?.content ?? "";
    expect(notice).toContain("Im Plan-Modus blockiert (1): Bash: npm test");
    expect(notice).toContain("schreibgeschützt");
    expect(notice).not.toContain("ExitPlanMode");
    expect(notice).not.toContain("Erlaube die Werkzeuge");
    // Only the expected plan request: nothing to report.
    expect(denialNotice([{ tool_name: "ExitPlanMode" }], "plan")).toBeNull();
    expect(denialNotice([{ tool_name: "ExitPlanMode" }], "default")).toContain("Erlaube die Werkzeuge");
  });
});

describe("tool/provider lookups with free-text keys", () => {
  it("maps allowedTools for gemini without consulting Object.prototype", () => {
    expect(mapToolsForGemini("Read,Bash")).toBe("read_file,read_many_files,list_directory,run_shell_command");
    // Unknown names pass through unchanged — prototype names included; they
    // used to resolve to inherited functions and throw "is not iterable".
    expect(mapToolsForGemini("constructor,toString,Glob")).toBe("constructor,toString,glob");
    expect(mapToolsForGemini("__proto__")).toBe("__proto__");
  });

  it("does not treat prototype names as plain agents", () => {
    expect(isPlainAgent("codex")).toBe(true);
    expect(isPlainAgent("constructor")).toBe(false);
    expect(isPlainAgent("toString")).toBe(false);
  });
});
