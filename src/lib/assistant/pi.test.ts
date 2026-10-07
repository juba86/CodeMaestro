import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "fs";
import http from "http";
import type { AddressInfo } from "net";
import { tmpdir } from "os";
import path from "path";

vi.mock("@/lib/github", () => ({ githubEnv: vi.fn(async () => ({})), GITHUB_SANDBOX_DOMAINS: [] }));

import {
  PiEventMapper,
  buildModelsJson,
  effectiveContext,
  mapToolsForPi,
  piGatedTools,
  piSessionIdFor,
  piToolDisplayName,
  piToolInputForDisplay,
  resetPiCaches,
  syncOllamaModels,
  type PiMapped,
} from "./pi";
import { runTurn, supportsApprovalGate, supportsSandbox, type AssistantSessionRow, type NormalizedEvent } from "./runner";
import approvalExtension, { toClaudeToolCall } from "../../../scripts/pi-approval-extension";

const FIXTURES = path.join(__dirname, "__fixtures__", "pi");
const fixture = (name: string) => readFileSync(path.join(FIXTURES, `${name}.jsonl`), "utf8");

// --- Fake Ollama metadata server (/api/tags + /api/show) ----------------------------
const OLLAMA_MODELS: Record<string, Record<string, unknown>> = {
  "qwen2.5-coder:14b": { capabilities: ["completion", "tools", "insert"], model_info: { "general.architecture": "qwen2", "qwen2.context_length": 32768 }, parameters: "num_ctx 16384\nstop \"<|im_end|>\"", details: { family: "qwen2", parameter_size: "14.8B" } },
  "qwen3:30b": { capabilities: ["completion", "tools", "thinking"], model_info: { "general.architecture": "qwen3moe", "qwen3moe.context_length": 262144 }, parameters: "temperature 0.6\ntop_p 0.95", details: { family: "qwen3moe", parameter_size: "30.5B" } },
  "llava:7b": { capabilities: ["completion", "vision"], model_info: { "general.architecture": "llama", "llama.context_length": 4096 }, parameters: "", details: { family: "llama", parameter_size: "7B" } },
  "nomic-embed-text:latest": { capabilities: ["embedding"], model_info: { "general.architecture": "nomic-bert", "nomic-bert.context_length": 2048 }, parameters: "", details: { family: "nomic-bert" } },
  "gemma4:12b": { capabilities: ["completion", "vision", "tools", "thinking"], model_info: { "general.architecture": "gemma4", "gemma4.context_length": 131072 }, details: { family: "gemma4" } },
};

let ollama: http.Server;
let ollamaUrl = "";
let showCalls = 0;
const agentDir = mkdtempSync(path.join(tmpdir(), "cm-pi-agent-"));
const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = ["OLLAMA_BASE_URL", "OLLAMA_CONTEXT_LENGTH", "PI_OLLAMA_CONTEXT_LENGTH", "CODEMAESTRO_PI_AGENT_DIR", "PI_BIN", "PATH", "FAKE_PI_MODE", "FAKE_PI_FIXTURE", "FAKE_PI_LOG"];

beforeAll(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  ollama = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/tags") {
        res.end(JSON.stringify({ models: Object.keys(OLLAMA_MODELS).map((name) => ({ name, model: name, digest: `d-${name}` })) }));
        return;
      }
      if (req.url === "/api/show") {
        showCalls++;
        const m = OLLAMA_MODELS[JSON.parse(body).model];
        res.statusCode = m ? 200 : 404;
        res.end(JSON.stringify(m ?? {}));
        return;
      }
      res.statusCode = 404;
      res.end("{}");
    });
  });
  await new Promise<void>((r) => ollama.listen(0, "127.0.0.1", r));
  ollamaUrl = `http://127.0.0.1:${(ollama.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  await new Promise((r) => ollama.close(r));
  rmSync(agentDir, { recursive: true, force: true });
});

beforeEach(() => {
  process.env.OLLAMA_BASE_URL = `${ollamaUrl}/v1/`; // /v1 and trailing slash are normalized away
  process.env.CODEMAESTRO_PI_AGENT_DIR = agentDir;
  delete process.env.OLLAMA_CONTEXT_LENGTH;
  delete process.env.PI_OLLAMA_CONTEXT_LENGTH;
  delete process.env.PI_BIN;
  resetPiCaches();
});

describe("syncOllamaModels → models.json", () => {
  it("maps Ollama capabilities and context onto pi models", async () => {
    const res = await syncOllamaModels({ force: true });
    expect(res.error).toBeUndefined();
    expect(res.ollamaBaseUrl).toBe(ollamaUrl);
    const byId = Object.fromEntries(res.models.map((m) => [m.id, m]));
    // Embedding-only models are not chat models.
    expect(Object.keys(byId)).toEqual(["qwen2.5-coder:14b", "qwen3:30b", "llava:7b", "gemma4:12b"]);
    // Modelfile num_ctx wins over the server fallback; capped by the trained context.
    expect(byId["qwen2.5-coder:14b"]).toMatchObject({ toolsOk: true, reasoning: false, vision: false, contextWindow: 16384 });
    expect(byId["qwen3:30b"]).toMatchObject({ toolsOk: true, reasoning: true, vision: false, contextWindow: 32768 });
    expect(byId["llava:7b"]).toMatchObject({ toolsOk: false, reasoning: false, vision: true, contextWindow: 4096 });
    expect(byId["gemma4:12b"]).toMatchObject({ toolsOk: true, reasoning: true, vision: true, contextWindow: 32768 });

    const cfg = JSON.parse(readFileSync(path.join(agentDir, "models.json"), "utf8"));
    const prov = cfg.providers.ollama;
    expect(prov).toMatchObject({
      baseUrl: `${ollamaUrl}/v1`,
      api: "openai-completions",
      apiKey: "ollama",
      compat: { supportsDeveloperRole: false, supportsStore: false, maxTokensField: "max_tokens" },
    });
    const def = Object.fromEntries(prov.models.map((m: { id: string }) => [m.id, m]));
    expect(def["qwen3:30b"]).toMatchObject({
      reasoning: true,
      thinkingLevelMap: { off: "none", minimal: "low", xhigh: "high", max: "high" },
      input: ["text"],
      contextWindow: 32768,
      maxTokens: 8192,
      samplingParams: { temperature: 0.6, top_p: 0.95 },
    });
    expect(def["llava:7b"]).toMatchObject({ input: ["text", "image"], maxTokens: 1024 });
    expect(def["llava:7b"].thinkingLevelMap).toBeUndefined();
    expect(def["qwen2.5-coder:14b"].samplingParams).toBeUndefined();

    // Small-context compaction overrides land in settings.json.
    const settings = JSON.parse(readFileSync(path.join(agentDir, "settings.json"), "utf8"));
    expect(settings).toMatchObject({ httpIdleTimeoutMs: 900000, defaultProjectTrust: "never", retry: { maxRetries: 2 }, enableInstallTelemetry: false });
    expect(settings.compaction.modelOverrides["ollama/llava:7b"]).toEqual({ reserveTokens: 1024, keepRecentTokens: 1024 });
    expect(existsSync(path.join(agentDir, "sessions"))).toBe(true);
  });

  it("honours PI_OLLAMA_CONTEXT_LENGTH over OLLAMA_CONTEXT_LENGTH", async () => {
    process.env.OLLAMA_CONTEXT_LENGTH = "8192";
    expect(effectiveContext(OLLAMA_MODELS["qwen3:30b"])).toBe(8192);
    process.env.PI_OLLAMA_CONTEXT_LENGTH = "65536";
    const res = await syncOllamaModels({ force: true });
    const ctx = Object.fromEntries(res.models.map((m) => [m.id, m.contextWindow]));
    expect(ctx).toMatchObject({ "qwen2.5-coder:14b": 16384, "qwen3:30b": 65536, "llava:7b": 4096 });
  });

  it("writes atomically, skips unchanged files and keeps user settings", async () => {
    await syncOllamaModels({ force: true });
    const file = path.join(agentDir, "models.json");
    const settingsFile = path.join(agentDir, "settings.json");
    const settings = JSON.parse(readFileSync(settingsFile, "utf8"));
    writeFileSync(settingsFile, JSON.stringify({ ...settings, myOwnKey: 1, httpIdleTimeoutMs: 5 }));
    const ino = statSync(file).ino;
    const shows = showCalls;
    await syncOllamaModels({ force: true });
    expect(statSync(file).ino).toBe(ino); // identical content → not rewritten
    expect(showCalls).toBe(shows); // /api/show results are cached by digest
    expect(readdirSync(agentDir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    const after = JSON.parse(readFileSync(settingsFile, "utf8"));
    expect(after.myOwnKey).toBe(1);
    expect(after.httpIdleTimeoutMs).toBe(900000);
  });

  it("never throws on an Ollama outage and keeps the last good list", async () => {
    const good = await syncOllamaModels({ force: true });
    const before = readFileSync(path.join(agentDir, "models.json"), "utf8");
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:9"; // nothing listens there
    const down = await syncOllamaModels({ force: true });
    expect(down.error).toMatch(/Ollama nicht erreichbar/);
    expect(down.models).toEqual(good.models);
    expect(readFileSync(path.join(agentDir, "models.json"), "utf8")).toBe(before);
    // After a restart (empty memory) the list comes from the sidecar file.
    resetPiCaches();
    const cold = await syncOllamaModels({ force: true });
    expect(cold.error).toBeTruthy();
    expect(cold.models.map((m) => m.id)).toEqual(good.models.map((m) => m.id));
  });

  it("builds a models.json without models", () => {
    const cfg = buildModelsJson([], "http://h:1") as { providers: { ollama: { baseUrl: string; models: unknown[] } } };
    expect(cfg.providers.ollama.baseUrl).toBe("http://h:1/v1");
    expect(cfg.providers.ollama.models).toEqual([]);
  });
});

describe("tool mapping", () => {
  it("maps Claude-style allowedTools onto pi tools", () => {
    expect(mapToolsForPi("Read,Grep,Glob")).toEqual(["read", "grep", "find", "ls"]);
    // pi cannot restrict bash to command patterns → no bash at all.
    expect(mapToolsForPi("Read,Bash(git *),Bash(gh *),WebSearch,WebFetch")).toEqual(["read", "grep", "find", "ls"]);
    expect(mapToolsForPi("Edit,Write,Bash")).toEqual(["edit", "write", "bash"]);
    expect(mapToolsForPi("Read,Edit,Write,Bash", "plan")).toEqual(["read", "grep", "find", "ls"]);
    expect(mapToolsForPi("")).toEqual([]);
  });

  it("gates write+edit for edits and bash too for all", () => {
    expect(piGatedTools("off")).toEqual([]);
    expect(piGatedTools(undefined)).toEqual([]);
    expect(piGatedTools("edits")).toEqual(["write", "edit"]);
    expect(piGatedTools("all")).toEqual(["write", "edit", "bash"]);
    expect(supportsApprovalGate("pi")).toBe(true);
    expect(supportsSandbox("pi")).toBe(false);
    expect(supportsSandbox("claude")).toBe(true);
  });

  it("renders pi tool calls like Claude's", () => {
    expect(["read", "write", "edit", "bash", "grep", "find", "ls", "custom"].map(piToolDisplayName))
      .toEqual(["Read", "Write", "Edit", "Bash", "Grep", "Glob", "LS", "custom"]);
    expect(piToolInputForDisplay("write", { path: "a.txt", content: "x" })).toEqual({ file_path: "a.txt", content: "x" });
    expect(piToolInputForDisplay("read", { path: "a.txt", offset: 2 })).toEqual({ file_path: "a.txt", offset: 2 });
    expect(piToolInputForDisplay("edit", { path: "a.txt", edits: [{ oldText: "a", newText: "b" }] }))
      .toEqual({ file_path: "a.txt", old_string: "a", new_string: "b" });
    expect(piToolInputForDisplay("edit", { path: "a.txt", edits: [{ oldText: "a", newText: "b" }], oldText: "c", newText: "d" }))
      .toEqual({ file_path: "a.txt", edits: [{ old_string: "a", new_string: "b" }, { old_string: "c", new_string: "d" }] });
    expect(piToolInputForDisplay("grep", { pattern: "x", path: "src" })).toEqual({ pattern: "x", path: "src" });
    expect(piToolInputForDisplay("bash", { command: "ls" })).toEqual({ command: "ls" });
  });

  it("keeps a valid stored pi session id and mints unique new ones", () => {
    expect(piSessionIdFor("s1", "cm-s1-abc")).toBe("cm-s1-abc");
    const a = piSessionIdFor("s1", null);
    const b = piSessionIdFor("s1", null);
    expect(a).toMatch(/^cm-s1-[a-z0-9]+$/);
    expect(a).not.toBe(b);
    expect(piSessionIdFor("s1", "gemini~s1")).toMatch(/^cm-s1-/); // a marker is not a pi id
  });
});

// Runs captured `pi --mode json` output through the mapper; consecutive deltas
// are joined like the runner's coalescer does.
function mapFixture(name: string, model = "mock-coder") {
  const mapper = new PiEventMapper(model);
  const events: NormalizedEvent[] = [];
  const push = (m: PiMapped) => {
    if (m.kind === "event") { events.push(m.event); return; }
    const last = events[events.length - 1];
    if (last && last.type === m.type && (last as { _delta?: boolean })._delta) last.content += m.content;
    else events.push({ type: m.type, content: m.content, _delta: true } as NormalizedEvent);
  };
  for (const line of fixture(name).split("\n")) mapper.handleLine(line).forEach(push);
  mapper.finish({ stopped: false }).forEach(push);
  return { mapper, events: events.map(({ ...e }) => { delete (e as { _delta?: boolean })._delta; return e; }) };
}

describe("PiEventMapper (captured pi 1.0.4 samples)", () => {
  it("maps a write turn", () => {
    const { mapper, events } = mapFixture("json-mode-sample");
    expect(events.map((e) => e.type)).toEqual(["init", "text", "tool_use", "tool_result", "text", "result"]);
    expect(events[0]).toEqual({ type: "init", sessionId: "01a117f4-832e-7491-b61b-c1ac9d2b3312", model: "mock-coder" });
    expect(events[1].content).toBe("I'll create the file.");
    expect(events[2]).toEqual({ type: "tool_use", name: "Write", input: { file_path: "hello.txt", content: "Hello from the mock model\n" }, toolUseId: "call_mock_1" });
    expect(events[3]).toEqual({ type: "tool_result", toolUseId: "call_mock_1", content: "Successfully wrote to hello.txt", isError: false });
    expect(events[5]).toEqual({ type: "result", content: 'Done. Tool said: "Successfully wrote to hello.txt"', costUsd: 0, isError: false });
    expect(mapper.externalId).toBe("01a117f4-832e-7491-b61b-c1ac9d2b3312");
    expect(mapper.isError).toBe(false);
  });

  it("maps thinking deltas", () => {
    const { events } = mapFixture("thinking-sample");
    expect(events.map((e) => e.type)).toEqual(["init", "thinking", "text", "tool_use", "tool_result", "thinking", "text", "result"]);
    expect(events[1].content).toBe("Let me think about the file.");
  });

  it("maps bash and resumed session ids", () => {
    const { mapper, events } = mapFixture("t2");
    expect(mapper.externalId).toBe("cm-conv-42");
    expect(events.find((e) => e.type === "tool_use")).toMatchObject({ name: "Bash", input: { command: "echo hi > bash.txt && ls" } });
    expect(events.find((e) => e.type === "tool_result")?.content).toBe("bash.txt\nhello.txt\n");
  });

  it("reports a denied tool call as a failed tool result, not a failed turn", () => {
    const { mapper, events } = mapFixture("approval-deny");
    expect(events.find((e) => e.type === "tool_result")).toMatchObject({ isError: true, content: "Denied by CodeMaestro user" });
    expect(mapper.isError).toBe(false);
  });

  it("detects a provider failure although pi exits 0 (one error after retries)", () => {
    const { mapper, events } = mapFixture("dead");
    const errors = events.filter((e) => e.type === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].content).toContain("Connection error.");
    expect(events[events.length - 1]).toMatchObject({ type: "result", isError: true });
    expect(mapper.isError).toBe(true);
  });

  it("ignores garbage lines and reports a run without end records", () => {
    const mapper = new PiEventMapper("m");
    expect(mapper.handleLine("not json")).toEqual([]);
    expect(mapper.handleLine("")).toEqual([]);
    mapper.handleLine(JSON.stringify({ type: "session", id: "x" }));
    expect(mapper.sawEnd).toBe(false);
    expect(mapper.incomplete("")[0]).toMatchObject({ kind: "event", event: { type: "error" } });
  });
});

// --- End to end: runTurn with a fake `pi` on PATH ---------------------------------------
const binDir = mkdtempSync(path.join(tmpdir(), "cm-fake-pi-"));
const workDir = mkdtempSync(path.join(tmpdir(), "cm-pi-work-"));
const logFile = path.join(binDir, "invocation.json");

const FAKE_PI = `#!/usr/bin/env node
const fs = require("fs");
const args = process.argv.slice(2);
if (args[0] === "--version") { process.stdout.write("1.0.4\\n"); process.exit(0); }
const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  const env = {};
  for (const k of ["PI_CODING_AGENT_DIR", "PI_OFFLINE", "PI_SKIP_VERSION_CHECK", "PI_TELEMETRY", "CM_PI_GATED", "PB_BASE_URL", "PB_SESSION_ID", "PB_HOOK_TOKEN"]) env[k] = process.env[k];
  fs.writeFileSync(process.env.FAKE_PI_LOG, JSON.stringify({ args, stdin: Buffer.concat(chunks).toString("utf8"), env, cwd: process.cwd() }));
  const sid = args[args.indexOf("--session-id") + 1];
  const mode = process.env.FAKE_PI_MODE || "fixture";
  if (mode === "hang") {
    process.stdout.write(JSON.stringify({ type: "session", id: sid }) + "\\n");
    for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { fs.writeFileSync(process.env.FAKE_PI_LOG + ".sig", sig); process.exit(sig === "SIGINT" ? 130 : 143); });
    setInterval(() => {}, 1000);
    return;
  }
  if (mode === "truncated") {
    process.stdout.write(JSON.stringify({ type: "session", id: sid }) + "\\n");
    process.stderr.write("pi crashed\\n");
    return;
  }
  if (mode === "crash") {
    process.stdout.write(JSON.stringify({ type: "session", id: sid }) + "\\n");
    process.stderr.write("TypeError: boom\\n");
    process.exitCode = 1;
    return;
  }
  const lines = fs.readFileSync(process.env.FAKE_PI_FIXTURE, "utf8").split("\\n").filter(Boolean);
  const first = JSON.parse(lines[0]);
  first.id = sid;
  lines[0] = JSON.stringify(first);
  const all = Buffer.from(lines.join("\\n") + "\\n");
  const cut = Math.floor(all.length / 2); // split mid-line to exercise buffering
  process.stdout.write(all.subarray(0, cut));
  setTimeout(() => process.stdout.write(all.subarray(cut)), 20);
});
`;

beforeAll(() => {
  writeFileSync(path.join(binDir, "pi"), FAKE_PI);
  chmodSync(path.join(binDir, "pi"), 0o755);
});
afterAll(() => {
  rmSync(binDir, { recursive: true, force: true });
  rmSync(workDir, { recursive: true, force: true });
});

interface Invocation { args: string[]; stdin: string; env: Record<string, string | undefined>; cwd: string }
const invocation = (): Invocation => JSON.parse(readFileSync(logFile, "utf8"));
const argAfter = (inv: Invocation, flag: string) => inv.args[inv.args.indexOf(flag) + 1];

function piRow(id: string, extra: Partial<AssistantSessionRow> = {}): AssistantSessionRow {
  return {
    id, externalId: null, provider: "pi", model: "", cwd: workDir,
    permissionMode: "default", allowedTools: "Read,Grep,Glob", approvalMode: "off", sandbox: false, ...extra,
  };
}

async function turn(row: AssistantSessionRow, prompt = "hi", opts: { signal?: AbortSignal } = {}) {
  const events: NormalizedEvent[] = [];
  const res = await runTurn(row, prompt, undefined, (e) => events.push(e), opts);
  return { res, events };
}

describe("runTurn (pi --mode json)", () => {
  beforeEach(() => {
    process.env.PATH = `${binDir}${path.delimiter}${savedEnv.PATH}`;
    process.env.FAKE_PI_LOG = logFile;
    process.env.FAKE_PI_FIXTURE = path.join(FIXTURES, "json-mode-sample.jsonl");
    delete process.env.FAKE_PI_MODE;
    rmSync(logFile, { force: true });
  });
  afterEach(() => {
    delete process.env.FAKE_PI_MODE;
  });

  it("sends the prompt via stdin and starts a new pi session", async () => {
    const prompt = "@missing.txt fix it\n- and keep ümlauts";
    const { res, events } = await turn(piRow("p1"), prompt);
    const inv = invocation();
    expect(inv.stdin).toBe(prompt);
    expect(inv.args).not.toContain(prompt);
    expect(inv.cwd).toBe(workDir);
    expect(inv.args.slice(0, 4)).toEqual(["--mode", "json", "--model", "ollama/qwen2.5-coder:14b"]);
    expect(argAfter(inv, "--session-dir")).toBe(path.join(agentDir, "sessions"));
    const sid = argAfter(inv, "--session-id");
    expect(sid).toMatch(/^cm-p1-[a-z0-9]+$/);
    expect(argAfter(inv, "--tools")).toBe("read,grep,find,ls");
    for (const f of ["--no-extensions", "--no-mcp", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-approve"]) expect(inv.args).toContain(f);
    expect(inv.args).not.toContain("-e");
    expect(inv.env).toMatchObject({ PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0" });
    expect(inv.env.CM_PI_GATED).toBeUndefined();
    expect(existsSync(path.join(agentDir, "models.json"))).toBe(true);

    expect(res).toEqual({ externalId: sid, costUsd: 0, isError: false });
    expect(events.map((e) => e.type)).toEqual(["init", "text", "tool_use", "tool_result", "text", "result", "done"]);
    expect(events.find((e) => e.type === "tool_use")).toMatchObject({ name: "Write", input: { file_path: "hello.txt" } });
  });

  it("resumes the stored pi session", async () => {
    const { res } = await turn(piRow("p2", { externalId: "cm-p2-old1", model: "ollama/qwen3:30b" }));
    const inv = invocation();
    expect(argAfter(inv, "--session-id")).toBe("cm-p2-old1");
    expect(argAfter(inv, "--model")).toBe("ollama/qwen3:30b");
    expect(res.externalId).toBe("cm-p2-old1");
  });

  it("detects a failed provider call although pi exits 0", async () => {
    process.env.FAKE_PI_FIXTURE = path.join(FIXTURES, "dead.jsonl");
    const { res, events } = await turn(piRow("p3"));
    expect(res.isError).toBe(true);
    const errors = events.filter((e) => e.type === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].content).toContain("Connection error.");
    expect(events[events.length - 1].type).toBe("done");
  });

  it("reports a run that exits 0 without pi's end records", async () => {
    process.env.FAKE_PI_MODE = "truncated";
    const { res, events } = await turn(piRow("p4"));
    expect(res.isError).toBe(true);
    expect(events.find((e) => e.type === "error")?.content).toContain("pi crashed");
  });

  it("reports a crash (non-zero exit after the session started) before the result", async () => {
    process.env.FAKE_PI_MODE = "crash";
    const { res, events } = await turn(piRow("p4b"));
    expect(res.isError).toBe(true);
    const types = events.map((e) => e.type);
    expect(types).toEqual(["init", "error", "result", "done"]);
    expect(events[1].content).toContain("TypeError: boom");
    expect(events[2]).toMatchObject({ type: "result", isError: true });
  });

  it("refuses a model the AI server does not have, and accepts a bare name for :latest", async () => {
    const before = showCalls;
    const { res, events } = await turn(piRow("p4c", { model: "not-pulled:1b" }));
    expect(res.isError).toBe(true);
    expect(events[0].content).toContain("ollama pull not-pulled:1b");
    expect(existsSync(logFile)).toBe(false);
    // The cached list was re-read once before giving up.
    expect(showCalls).toBeGreaterThan(before);

    await turn(piRow("p4d", { model: "ollama/nomic-embed-text" }));
    expect(existsSync(logFile)).toBe(false); // embedding-only → not a chat model

    OLLAMA_MODELS["devstral:latest"] = { capabilities: ["completion", "tools"], model_info: {}, parameters: "" };
    try {
      const ok = await turn(piRow("p4e", { model: "devstral" }));
      expect(ok.res.isError).toBe(false);
      expect(argAfter(invocation(), "--model")).toBe("ollama/devstral:latest");
    } finally {
      delete OLLAMA_MODELS["devstral:latest"];
    }
  });

  it("loads the approval gate and passes the hook env when approval is on", async () => {
    await turn(piRow("p5", { approvalMode: "edits", allowedTools: "Read,Edit,Write,Bash" }));
    const inv = invocation();
    expect(argAfter(inv, "-e")).toBe(path.join(process.cwd(), "scripts", "pi-approval-extension.ts"));
    expect(argAfter(inv, "--tools")).toBe("read,grep,find,ls,edit,write,bash");
    expect(inv.env.CM_PI_GATED).toBe("write,edit");
    expect(inv.env.PB_SESSION_ID).toBe("p5");
    expect(inv.env.PB_HOOK_TOKEN).toBeTruthy();
    expect(inv.env.PB_BASE_URL).toMatch(/^http/);
  });

  it("runs models without tool support with --no-tools", async () => {
    await turn(piRow("p6", { model: "llava:7b", allowedTools: "Read,Edit" }));
    const inv = invocation();
    expect(inv.args).toContain("--no-tools");
    expect(inv.args).not.toContain("--tools");
  });

  it("fails closed for a sandboxed session (pi has no sandbox)", async () => {
    const { res, events } = await turn(piRow("p7", { sandbox: true }));
    expect(res.isError).toBe(true);
    expect(events[0]).toMatchObject({ type: "error" });
    expect(existsSync(logFile)).toBe(false);
  });

  it("stops a running pi via SIGTERM (pi then also kills its bash tool)", async () => {
    process.env.FAKE_PI_MODE = "hang";
    const ac = new AbortController();
    const events: NormalizedEvent[] = [];
    const p = runTurn(piRow("p8"), "x", undefined, (e) => events.push(e), { signal: ac.signal });
    await vi.waitFor(() => expect(events.some((e) => e.type === "init")).toBe(true));
    ac.abort();
    const res = await p;
    expect(res.isError).toBe(true);
    expect(events.some((e) => e.type === "error" && e.content === "Gestoppt.")).toBe(true);
    expect(events.some((e) => e.type === "result")).toBe(false);
    expect(readFileSync(`${logFile}.sig`, "utf8")).toBe("SIGTERM");
  });
});

describe("GET/POST /api/assistant/pi", () => {
  beforeEach(() => {
    process.env.PATH = `${binDir}${path.delimiter}${savedEnv.PATH}`;
  });

  it("reports the installed pi and the synced models", async () => {
    const { GET } = await import("@/app/api/assistant/pi/route");
    const body = await (await GET()).json();
    expect(body).toMatchObject({
      installed: true,
      version: "1.0.4",
      bin: "pi",
      agentDir,
      ollamaBaseUrl: ollamaUrl,
      installHint: "npm install -g --ignore-scripts @earendil-works/pi-coding-agent",
    });
    expect(body.error).toBeUndefined();
    expect(body.models.map((m: { id: string }) => m.id)).toContain("qwen3:30b");
  });

  it("reports a missing binary and re-syncs on POST", async () => {
    process.env.PI_BIN = path.join(binDir, "does-not-exist");
    const { POST } = await import("@/app/api/assistant/pi/route");
    const res = await POST(new Request("http://x/api/assistant/pi", { method: "POST", body: JSON.stringify({ force: true }) }) as never);
    const body = await res.json();
    expect(body.installed).toBe(false);
    expect(body.error).toContain("nicht gefunden");
    expect(body.models.length).toBe(4);
    const bad = await POST(new Request("http://x/api/assistant/pi", { method: "POST", body: "{" }) as never);
    expect(bad.status).toBe(400);
  });
});

// --- Approval extension ------------------------------------------------------------------------
type Handler = (event: { type: "tool_call"; toolCallId: string; toolName: string; input: Record<string, unknown> }, ctx: { cwd: string; signal: AbortSignal | undefined }) => Promise<{ block: true; reason: string } | undefined>;

function loadExtension(): Handler {
  let handler: Handler | undefined;
  approvalExtension({ on: (_e: "tool_call", h: Handler) => { handler = h; } });
  if (!handler) throw new Error("no tool_call handler registered");
  return handler;
}

describe("pi approval extension", () => {
  let server: http.Server;
  let base = "";
  const requests: Array<{ url: string; body: Record<string, unknown>; token: string | undefined }> = [];
  let decision: "allow" | "deny" = "allow";
  let polls = 0;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
        requests.push({ url: req.url ?? "", body: body ? JSON.parse(body) : {}, token: req.headers["x-codemaestro-hook-token"] as string | undefined });
        if (req.url === "/api/assistant/approval/request") return void res.end(JSON.stringify({ approvalId: "apr_1" }));
        if (req.url?.startsWith("/api/assistant/approval/apr_1/wait")) {
          // First poll: still pending; then the user's decision.
          if (polls++ === 0) return void res.end(JSON.stringify({ status: "pending" }));
          return void res.end(JSON.stringify({ status: "decided", decision, reason: decision === "deny" ? "Nein" : "" }));
        }
        res.statusCode = 404;
        res.end("{}");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise((r) => server.close(r));
  });
  beforeEach(() => {
    requests.length = 0;
    polls = 0;
    process.env.PB_BASE_URL = base;
    process.env.PB_SESSION_ID = "sess-1";
    process.env.PB_HOOK_TOKEN = "tok";
    process.env.CM_PI_GATED = "write,edit";
  });
  afterEach(() => {
    for (const k of ["PB_BASE_URL", "PB_SESSION_ID", "PB_HOOK_TOKEN", "CM_PI_GATED"]) delete process.env[k];
  });

  it("maps pi input to Claude-shaped approval input", () => {
    expect(toClaudeToolCall("write", { path: "a/b.txt", content: "x" }, "/w")).toEqual({ tool: "Write", input: { file_path: "/w/a/b.txt", content: "x" } });
    expect(toClaudeToolCall("edit", { path: "@/abs.txt", edits: [{ oldText: "a", newText: "b" }] }, "/w"))
      .toEqual({ tool: "MultiEdit", input: { file_path: "/abs.txt", edits: [{ old_string: "a", new_string: "b" }] } });
    expect(toClaudeToolCall("edit", { path: "x", edits: JSON.stringify([{ oldText: "1", newText: "2" }]) }, "/w").input.edits)
      .toEqual([{ old_string: "1", new_string: "2" }]);
    expect(toClaudeToolCall("bash", { command: "ls -la", timeout: 5 }, "/w")).toEqual({ tool: "Bash", input: { command: "ls -la" } });
  });

  it("lets ungated tools through without asking", async () => {
    const r = await loadExtension()({ type: "tool_call", toolCallId: "c1", toolName: "bash", input: { command: "ls" } }, { cwd: "/w", signal: undefined });
    expect(r).toBeUndefined();
    expect(requests).toHaveLength(0);
  });

  it("asks CodeMaestro and allows after approval", async () => {
    decision = "allow";
    const r = await loadExtension()({ type: "tool_call", toolCallId: "c1", toolName: "write", input: { path: "f.txt", content: "hi" } }, { cwd: "/w", signal: undefined });
    expect(r).toBeUndefined();
    expect(requests[0]).toEqual({
      url: "/api/assistant/approval/request",
      body: { sessionId: "sess-1", tool: "Write", input: { file_path: "/w/f.txt", content: "hi" } },
      token: "tok",
    });
    expect(requests.filter((q) => q.url.includes("/wait"))).toHaveLength(2);
  });

  it("blocks with the user's reason on deny", async () => {
    decision = "deny";
    const r = await loadExtension()({ type: "tool_call", toolCallId: "c1", toolName: "edit", input: { path: "f.txt", edits: [{ oldText: "a", newText: "b" }] } }, { cwd: "/w", signal: undefined });
    expect(r).toEqual({ block: true, reason: "Nein" });
    expect(requests[0].body.tool).toBe("MultiEdit");
  });

  it("fails closed when misconfigured, unreachable or aborted", async () => {
    delete process.env.PB_BASE_URL;
    const write = { type: "tool_call" as const, toolCallId: "c1", toolName: "write", input: { path: "f", content: "" } };
    expect(await loadExtension()(write, { cwd: "/w", signal: undefined })).toMatchObject({ block: true });

    process.env.PB_BASE_URL = "http://127.0.0.1:9";
    expect(await loadExtension()(write, { cwd: "/w", signal: undefined })).toMatchObject({ block: true });

    process.env.PB_BASE_URL = base;
    const ac = new AbortController();
    ac.abort();
    expect(await loadExtension()(write, { cwd: "/w", signal: ac.signal })).toMatchObject({ block: true });

    // Unset gate list → every mutating tool is gated.
    delete process.env.CM_PI_GATED;
    delete process.env.PB_BASE_URL;
    const bash = { type: "tool_call" as const, toolCallId: "c2", toolName: "bash", input: { command: "rm -rf x" } };
    expect(await loadExtension()(bash, { cwd: "/w", signal: undefined })).toMatchObject({ block: true });
  });
});
