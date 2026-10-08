import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

vi.mock("@/lib/github", () => ({ githubEnv: vi.fn(async () => ({})), GITHUB_SANDBOX_DOMAINS: [] }));

import { runTurn, isRunning, isPlainAgent, mapToolsForGemini, stopSession, type AssistantSessionRow, type NormalizedEvent } from "./runner";

// A stand-in `claude` binary on PATH that replays a scripted stream-json run.
const binDir = mkdtempSync(path.join(tmpdir(), "cm-fake-claude-"));
const workDir = mkdtempSync(path.join(tmpdir(), "cm-work-"));
const oldPath = process.env.PATH;

const FAKE = `#!/usr/bin/env node
const mode = process.env.FAKE_MODE || "stream";
const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
if (mode === "hang") {
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
});

function row(id: string, extra: Partial<AssistantSessionRow> = {}): AssistantSessionRow {
  return {
    id, externalId: null, provider: "claude", model: "", cwd: workDir,
    permissionMode: "default", allowedTools: "Read", approvalMode: "off", sandbox: false, ...extra,
  };
}

describe("runTurn (claude stream-json)", () => {
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
