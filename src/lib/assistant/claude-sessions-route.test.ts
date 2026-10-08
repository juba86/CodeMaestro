import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { NextRequest } from "next/server";

// "Projekt fortsetzen": GET /api/assistant/claude-sessions and the resume path
// of POST /api/assistant/sessions, against real conversation files in a temp
// CLAUDE_CONFIG_DIR and an in-memory session table.

type Row = { id: string; externalId?: string | null; [k: string]: unknown };
const state = vi.hoisted(() => ({ rows: [] as Row[], created: [] as Record<string, unknown>[], raceOnCreate: null as Row | null }));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    assistantSession: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (state.raceOnCreate) {
          state.rows.push(state.raceOnCreate);
          throw Object.assign(new Error("Unique constraint failed on the fields: (`externalId`)"), { code: "P2002" });
        }
        state.created.push(data);
        const row = { id: `s${state.created.length}`, ...data };
        state.rows.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { externalId: string } }) => {
        const row = state.rows.find((r) => r.externalId === where.externalId);
        return row ? { id: row.id } : null;
      },
      findMany: async ({ where }: { where: { externalId: { in: string[] } } }) =>
        state.rows.filter((r) => r.externalId && where.externalId.in.includes(r.externalId)).map((r) => ({ id: r.id, externalId: r.externalId })),
    },
  },
}));
vi.mock("@/lib/assistant/security", () => ({
  resolveWorkdir: async (p?: string) => {
    if (p === "/outside") throw new Error("Working directory is outside the allowed roots: /outside");
    return p || "/work";
  },
}));

import { GET } from "@/app/api/assistant/claude-sessions/route";
import { POST } from "@/app/api/assistant/sessions/route";
import { claudeProjectSlug, resetClaudeSessionCaches } from "@/lib/assistant/claude-sessions";

const CWD = "/w/app";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const MISSING = "33333333-3333-4333-8333-333333333333";

let config: string;
const savedEnv = process.env.CLAUDE_CONFIG_DIR;

function conversation(id: string, prompt: string, cwd = CWD, mtime = Date.UTC(2026, 9, 8)) {
  const dir = path.join(config, "projects", claudeProjectSlug(cwd));
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.jsonl`);
  writeFileSync(
    file,
    [
      { type: "user", cwd, message: { role: "user", content: prompt } },
      { type: "assistant", cwd, message: { id: `m-${id}`, role: "assistant", content: [{ type: "text", text: "ok" }] } },
    ]
      .map((l) => JSON.stringify(l))
      .join("\n") + "\n"
  );
  utimesSync(file, new Date(mtime), new Date(mtime));
}

function get(cwd?: string) {
  const qs = cwd === undefined ? "" : `?cwd=${encodeURIComponent(cwd)}`;
  return GET(new NextRequest(`http://127.0.0.1:3000/api/assistant/claude-sessions${qs}`));
}

function post(body: Record<string, unknown>) {
  return POST(
    new NextRequest("http://127.0.0.1:3000/api/assistant/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  config = mkdtempSync(path.join(tmpdir(), "cm-claude-route-"));
  process.env.CLAUDE_CONFIG_DIR = config;
  resetClaudeSessionCaches();
  state.rows.length = 0;
  state.created.length = 0;
  state.raceOnCreate = null;
});

afterEach(() => {
  rmSync(config, { recursive: true, force: true });
  if (savedEnv === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = savedEnv;
});

describe("GET /api/assistant/claude-sessions", () => {
  it("lists the folder's conversations newest first and marks linked ones", async () => {
    conversation(A, "Login bauen", CWD, Date.UTC(2026, 9, 7));
    conversation(B, "Tests reparieren", CWD, Date.UTC(2026, 9, 8));
    state.rows.push({ id: "cm1", externalId: A });
    const res = await get(CWD);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      sessions: [
        { id: B, title: "Tests reparieren", updatedAt: "2026-10-08T00:00:00.000Z", messageCount: 2 },
        { id: A, title: "Login bauen", updatedAt: "2026-10-07T00:00:00.000Z", messageCount: 2, linkedSessionId: "cm1" },
      ],
    });
  });

  it("returns an empty list for a folder without conversations", async () => {
    expect(await (await get("/w/empty")).json()).toEqual({ sessions: [] });
  });

  it("rejects a folder outside the allowed roots like the sessions route", async () => {
    const res = await get("/outside");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Working directory is outside the allowed roots: /outside", code: "INVALID_CWD" });
  });
});

describe("POST /api/assistant/sessions with resumeSessionId", () => {
  it("links the conversation so the first turn runs with --resume and takes its title", async () => {
    conversation(A, "Login bauen");
    const res = await post({ provider: "claude", cwd: CWD, resumeSessionId: A });
    expect(res.status).toBe(201);
    expect(state.created).toHaveLength(1);
    expect(state.created[0]).toMatchObject({ provider: "claude", cwd: CWD, externalId: A, title: "Login bauen" });
    expect(state.created[0]).not.toHaveProperty("resumeSessionId");
  });

  it("keeps a given title", async () => {
    conversation(A, "Login bauen");
    expect((await post({ provider: "claude", cwd: CWD, resumeSessionId: A, title: "Übergabe" })).status).toBe(201);
    expect(state.created[0].title).toBe("Übergabe");
  });

  it("only resumes with Claude Code", async () => {
    conversation(A, "Login bauen");
    const res = await post({ provider: "codex", cwd: CWD, resumeSessionId: A });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "VALIDATION_ERROR", error: expect.stringContaining("Nur Claude Code") });
    expect(state.created).toEqual([]);
  });

  it("rejects malformed ids and conversations of other folders", async () => {
    conversation(A, "Login bauen", "/w/other");
    const bad = await post({ provider: "claude", cwd: CWD, resumeSessionId: "../../etc/passwd" });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { code: string }).code).toBe("VALIDATION_ERROR");

    for (const id of [A, MISSING]) {
      const res = await post({ provider: "claude", cwd: CWD, resumeSessionId: id });
      expect(res.status).toBe(400);
      const d = (await res.json()) as { error: string; code: string };
      expect(d.code).toBe("RESUME_NOT_FOUND");
      expect(d.error).toContain("Unterhaltung nicht gefunden");
    }
    expect(state.created).toEqual([]);
  });

  it("answers 409 with the session that already holds the conversation", async () => {
    conversation(A, "Login bauen");
    state.rows.push({ id: "cm1", externalId: A });
    const res = await post({ provider: "claude", cwd: CWD, resumeSessionId: A });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Diese Unterhaltung ist schon in CodeMaestro geöffnet.", code: "ALREADY_LINKED", sessionId: "cm1" });
    expect(state.created).toEqual([]);
  });

  it("answers 409 when a concurrent request linked it first", async () => {
    conversation(A, "Login bauen");
    state.raceOnCreate = { id: "cm2", externalId: A };
    const res = await post({ provider: "claude", cwd: CWD, resumeSessionId: A });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { sessionId: string }).sessionId).toBe("cm2");
  });

  it("starts a fresh conversation without resumeSessionId", async () => {
    expect((await post({ provider: "claude", cwd: CWD })).status).toBe(201);
    expect(state.created[0]).not.toHaveProperty("externalId");
    expect(state.created[0]).not.toHaveProperty("resumeSessionId");
  });
});
