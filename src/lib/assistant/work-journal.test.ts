import { beforeEach, describe, expect, it, vi } from "vitest";

type Entry = { id: string; cwd: string; sessionId: string; agent: string; task: string; summary: string; files: string; status: string; createdAt: Date };
type SessionRow = { id: string; cwd: string; provider: string; model: string; title: string; syncedAt: Date | null };

const db = vi.hoisted(() => ({ entries: [] as Entry[], sessions: new Map<string, SessionRow>() }));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    workLogEntry: {
      create: vi.fn(async ({ data }: { data: Omit<Entry, "id" | "createdAt"> }) => {
        const row = { ...data, id: `e${db.entries.length + 1}`, createdAt: new Date(Date.now() + db.entries.length) };
        db.entries.push(row);
        return row;
      }),
      findMany: vi.fn(async ({ where, take }: { where: { cwd?: string; sessionId?: string | { not: string }; createdAt?: { gt: Date } }; take: number }) =>
        db.entries
          .filter((e) => (where.cwd === undefined || e.cwd === where.cwd))
          .filter((e) => (typeof where.sessionId === "string" ? e.sessionId === where.sessionId : where.sessionId ? e.sessionId !== where.sessionId.not : true))
          .filter((e) => (where.createdAt ? e.createdAt > where.createdAt.gt : true))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, take)
      ),
    },
    assistantSession: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => db.sessions.get(where.id) ?? null),
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] }; cwd: string } }) =>
        [...db.sessions.values()].filter((s) => where.id.in.includes(s.id) && s.cwd === where.cwd)
      ),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { syncedAt: Date } }) => {
        const s = db.sessions.get(where.id);
        if (!s) throw new Error("missing");
        s.syncedAt = data.syncedAt;
        return s;
      }),
    },
  },
}));

import { activeElsewhere, agentLabel, markSynced, ownRecentWork, recapBlock, recordWork, syncBlock, unseenWork, type WorkEntry } from "./work-journal";
import { beginRun, endRun } from "./run-hub";

const session = (id: string, cwd: string, provider = "claude", model = ""): SessionRow => {
  const s = { id, cwd, provider, model, title: `Title ${id}`, syncedAt: null };
  db.sessions.set(id, s);
  return s;
};

beforeEach(() => {
  db.entries = [];
  db.sessions.clear();
});

describe("work journal", () => {
  it("names agents by provider and model", () => {
    expect(agentLabel("claude")).toBe("Claude Code");
    expect(agentLabel("pi", "kolibri")).toBe("pi · kolibri");
  });

  it("tells a session what the other sessions in the same directory did — once", async () => {
    session("claude-s", "/proj");
    session("pi-s", "/proj", "pi", "kolibri");
    session("other-proj", "/elsewhere");
    await recordWork({ cwd: "/proj", sessionId: "pi-s", agent: "pi · kolibri", task: "add login", summary: "looked around\n## Handoff\n- login in src/auth.ts", files: ["src/auth.ts"] });
    await recordWork({ cwd: "/elsewhere", sessionId: "other-proj", agent: "Claude Code", task: "x", summary: "y" });
    await recordWork({ cwd: "/proj", sessionId: "claude-s", agent: "Claude Code", task: "own", summary: "own work" });

    const first = await unseenWork("claude-s", "/proj");
    expect(first.entries.map((e) => e.task)).toEqual(["add login"]);
    // The stored summary is the handoff section, the files the measured list.
    expect(first.entries[0]).toMatchObject({ agent: "pi · kolibri", summary: "- login in src/auth.ts", files: ["src/auth.ts"], status: "done" });

    await markSynced("claude-s", first.readAt);
    expect((await unseenWork("claude-s", "/proj")).entries).toEqual([]);

    // Work that arrives afterwards is unseen again; the pi session sees Claude's entry.
    db.entries.push({ id: "late", cwd: "/proj", sessionId: "pi-s", agent: "pi · kolibri", task: "later", summary: "s", files: "[]", status: "error", createdAt: new Date(first.readAt.getTime() + 60_000) });
    expect((await unseenWork("claude-s", "/proj")).entries.map((e) => e.task)).toEqual(["later"]);
    expect((await unseenWork("pi-s", "/proj")).entries.map((e) => e.task)).toEqual(["own"]);
  });

  it("returns the newest few unseen entries, oldest first, and a never-synced session only the recent past", async () => {
    session("me", "/proj");
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    db.entries.push({ id: "old", cwd: "/proj", sessionId: "x", agent: "a", task: "ancient", summary: "s", files: "not json", status: "done", createdAt: old });
    for (let i = 1; i <= 7; i++) {
      db.entries.push({ id: `n${i}`, cwd: "/proj", sessionId: "x", agent: "a", task: `t${i}`, summary: "s", files: "[]", status: "done", createdAt: new Date(Date.now() - (8 - i) * 60_000) });
    }
    const { entries } = await unseenWork("me", "/proj");
    expect(entries.map((e) => e.task)).toEqual(["t3", "t4", "t5", "t6", "t7"]);
  });

  it("recaps a session's own recent work", async () => {
    for (const t of ["a", "b", "c", "d"]) await recordWork({ cwd: "/proj", sessionId: "s", agent: "Claude Code", task: t, summary: t });
    expect((await ownRecentWork("s")).map((e) => e.task)).toEqual(["b", "c", "d"]);
  });

  it("reports other sessions running in the same directory right now", async () => {
    session("me", "/proj");
    session("pi-s", "/proj", "pi", "kolibri");
    session("far", "/elsewhere");
    const runs = ["me", "pi-s", "far"].map((id) => ({ id, run: beginRun(id, "turn", "pwa") }));
    try {
      expect(await activeElsewhere("me", "/proj")).toEqual([{ agent: "pi · kolibri", title: "Title pi-s" }]);
    } finally {
      for (const r of runs) endRun(r.id, r.run.info.runId, "idle");
    }
    expect(await activeElsewhere("me", "/proj")).toEqual([]);
  });

  it("never throws when the database fails", async () => {
    const { prisma } = await import("@/lib/db/client");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(prisma.workLogEntry.create).mockRejectedValueOnce(new Error("locked"));
    vi.mocked(prisma.workLogEntry.findMany).mockRejectedValueOnce(new Error("locked"));
    await expect(recordWork({ cwd: "/p", sessionId: "s", agent: "a", task: "t", summary: "s" })).resolves.toBeUndefined();
    expect((await ownRecentWork("s"))).toEqual([]);
    await expect(markSynced("nobody", new Date())).resolves.toBeUndefined();
  });
});

const entry = (extra: Partial<WorkEntry> = {}): WorkEntry => ({
  agent: "pi · kolibri", task: "add login", summary: "- login in src/auth.ts", files: ["src/auth.ts"], status: "done",
  createdAt: new Date("2026-10-09T15:04:00Z"), ...extra,
});

describe("syncBlock / recapBlock", () => {
  it("is empty when there is nothing to tell", () => {
    expect(syncBlock([], [])).toBe("");
    expect(recapBlock([])).toBe("");
  });

  it("lists who did what, with files and a non-done status", () => {
    const block = syncBlock([entry(), entry({ agent: "Claude Code", status: "stopped", files: [] })]);
    expect(block.startsWith("<team_sync>")).toBe(true);
    expect(block).toContain('<work by="pi · kolibri" at="2026-10-09 15:04 UTC">');
    expect(block).toContain("<asked>add login</asked>\nFiles changed: src/auth.ts\n- login in src/auth.ts");
    expect(block).toContain('<work by="Claude Code" at="2026-10-09 15:04 UTC" status="stopped before it finished">');
    expect(block).toContain("re-read a file named below");
    expect(block).not.toContain("right now");
  });

  it("warns about an agent working in the directory right now", () => {
    const block = syncBlock([], [{ agent: "pi · kolibri", title: "Refactor\nauth" }]);
    expect(block).toContain('Another agent is working in this directory right now: pi · kolibri ("Refactor auth").');
    expect(block).toContain("do not revert changes you did not make");
  });

  it("recaps earlier work of the session", () => {
    expect(recapBlock([entry()])).toContain("<session_recap>\nEarlier work in this session");
  });
});
