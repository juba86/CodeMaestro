import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Fakes ---------------------------------------------------------------------------
type Row = Record<string, unknown> & { id: string; sessionId: string };

const state = vi.hoisted(() => ({
  schedules: [] as Row[],
  sessions: new Map<string, Record<string, unknown>>(),
  messages: [] as { sessionId: string; role: string; content: string; createdAt: Date }[],
  busy: new Set<string>(),
  launches: [] as { kind: string; origin: string; title?: string; userMessage?: { content: string; meta?: string } }[],
  loops: [] as { sessionId: string; cfg: Record<string, unknown>; origin: string; opts: Record<string, unknown> }[],
  turns: [] as { prompt: string; opts: Record<string, unknown> }[],
  pushes: [] as { title: string; body: string }[],
  telegrams: [] as string[],
  fingerprint: null as string | null,
  finish: [] as ((s: string) => void)[],
}));

function applyUpdate(row: Row, data: Record<string, unknown>) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && "increment" in (v as object)) row[k] = ((row[k] as number) ?? 0) + (v as { increment: number }).increment;
    else row[k] = v;
  }
  row.updatedAt = new Date();
  return row;
}

vi.mock("@/lib/db/client", () => ({
  prisma: {
    sessionSchedule: {
      findUnique: async ({ where }: { where: { id?: string; triggerToken?: string } }) =>
        state.schedules.find((r) => (where.id ? r.id === where.id : r.triggerToken === where.triggerToken)) ?? null,
      findMany: async ({ where, take }: { where?: { enabled?: boolean; nextRunAt?: { lte: Date }; sessionId?: string }; take?: number }) => {
        let rows = state.schedules;
        if (where?.enabled !== undefined) rows = rows.filter((r) => r.enabled === where.enabled);
        if (where?.nextRunAt) rows = rows.filter((r) => r.nextRunAt instanceof Date && r.nextRunAt <= where.nextRunAt!.lte);
        if (where?.sessionId) rows = rows.filter((r) => r.sessionId === where.sessionId);
        return rows.slice(0, take ?? rows.length).map((r) => ({ ...r, session: state.sessions.get(r.sessionId) ?? null }));
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = state.schedules.find((r) => r.id === where.id);
        if (!row) throw new Error("P2025");
        return { ...applyUpdate(row, data), session: state.sessions.get(row.sessionId) ?? null };
      },
      updateMany: async () => ({ count: 0 }),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `sch${state.schedules.length + 1}`, runCount: 0, failStreak: 0, lastRunAt: null, lastStatus: "", lastSummary: "", lastFingerprint: "", createdAt: new Date(), updatedAt: new Date(), ...data } as unknown as Row;
        state.schedules.push(row);
        return { ...row, session: state.sessions.get(row.sessionId) ?? null };
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const i = state.schedules.findIndex((r) => r.id === where.id);
        if (i < 0) throw new Error("P2025");
        return state.schedules.splice(i, 1)[0];
      },
      count: async () => state.schedules.length,
    },
    assistantSession: {
      findUnique: async ({ where }: { where: { id: string } }) => state.sessions.get(where.id) ?? null,
    },
    assistantMessage: {
      findFirst: async ({ where }: { where: { sessionId: string; role: { in: string[] }; createdAt: { gte: Date } } }) => {
        const rows = state.messages.filter((m) => m.sessionId === where.sessionId && where.role.in.includes(m.role) && m.createdAt >= where.createdAt.gte);
        rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return rows[0] ?? null;
      },
    },
  },
}));

vi.mock("@/lib/assistant/run-hub", () => ({
  SessionBusyError: class extends Error {},
  isSessionBusy: (id: string) => state.busy.has(id),
}));
vi.mock("@/lib/assistant/security", () => ({ resolveWorkdir: async (p: string) => (p === "/gone" ? Promise.reject(new Error("Working directory does not exist: /gone")) : p) }));
vi.mock("@/lib/assistant/orchestra", () => ({ resolveOrchestra: async () => ({ roles: [] }) }));
vi.mock("@/lib/assistant/orchestrator", () => ({ orchestrateRun: async () => ({ isError: false }) }));
vi.mock("@/lib/assistant/workdir-changes", () => ({ snapshotWorkdir: async () => (state.fingerprint === null ? null : { head: state.fingerprint, dirty: new Map() }) }));
vi.mock("@/lib/push", () => ({ sendPush: async (p: { title: string; body: string }) => { state.pushes.push(p); return { sent: 1, failed: 0, removed: 0 }; } }));
vi.mock("@/lib/assistant/telegram", () => ({ notifyTelegramChats: async (t: string) => { state.telegrams.push(t); return 1; } }));

function handle(kind: string, origin: string) {
  let resolve!: (s: string) => void;
  const finished = new Promise<string>((r) => { resolve = r; });
  state.finish.push(resolve);
  return { info: { runId: `run_${state.launches.length + state.loops.length}`, sessionId: "s1", kind, origin, startedAt: Date.now() - 1, done: false, lastSeq: 0, complete: true }, signal: new AbortController().signal, publish: () => {}, finished };
}

vi.mock("@/lib/assistant/session-run", () => ({
  toSessionRow: (s: Record<string, unknown>) => s,
  executeTurn: async (_ctx: unknown, prompt: string, opts: Record<string, unknown>) => { state.turns.push({ prompt, opts }); return { isError: false }; },
  launchRun: async (o: { sessionId: string; kind: string; origin: string; title?: string; userMessage?: { content: string; meta?: string }; work: (ctx: unknown) => Promise<unknown> }) => {
    state.launches.push({ kind: o.kind, origin: o.origin, title: o.title, userMessage: o.userMessage });
    void o.work({ sessionId: o.sessionId, runId: "r", signal: new AbortController().signal, publish: () => {}, writer: {} });
    return handle(o.kind, o.origin);
  },
}));
vi.mock("@/lib/assistant/loop", () => ({
  startLoopRun: async (sessionId: string, cfg: Record<string, unknown>, origin: string, opts: Record<string, unknown>) => {
    state.loops.push({ sessionId, cfg, origin, opts });
    return handle("loop", origin);
  },
}));

import { computeNextRun, createSchedule, finishRun, fireSchedule, headlineOf, tickSchedules, updateSchedule, workdirFingerprint, type ScheduleRow } from "./schedules";
import { DEFAULT_SCHEDULE_INPUT } from "./types";

const NOW = new Date(2026, 9, 14, 9, 0, 0).getTime();
const flush = () => new Promise((r) => setTimeout(r, 0));

// The fake rows are plain records; the module reads them like Prisma rows.
async function seed(over: Record<string, unknown> = {}) {
  const view = await createSchedule("s1", { ...DEFAULT_SCHEDULE_INPUT, name: "Nightly", prompt: "Run the tests.", cron: "0 2 * * *", ...over });
  return state.schedules.find((r) => r.id === view.id)! as unknown as ScheduleRow & Row;
}

beforeEach(() => {
  state.schedules.length = 0;
  state.sessions.clear();
  state.sessions.set("s1", { id: "s1", title: "Shop", cwd: "/apps/shop", provider: "claude", model: "", externalId: null, permissionMode: "default", allowedTools: "Read", approvalMode: "off", sandbox: false });
  state.messages.length = 0;
  state.busy.clear();
  state.launches.length = 0;
  state.loops.length = 0;
  state.turns.length = 0;
  state.pushes.length = 0;
  state.telegrams.length = 0;
  state.fingerprint = null;
  state.finish.length = 0;
});

describe("createSchedule / updateSchedule", () => {
  it("stores the fields, a trigger token and the next cron time", async () => {
    const v = await createSchedule("s1", { ...DEFAULT_SCHEDULE_INPUT, name: "Nightly", prompt: "Run the tests.", cron: "0 2 * * *" });
    expect(v.triggerToken.length).toBeGreaterThan(20);
    expect(v.nextRunAt).not.toBeNull();
    expect(v.session?.title).toBe("Shop");
    expect(v.loop.maxIterations).toBe(10);
    const off = await createSchedule("s1", { ...DEFAULT_SCHEDULE_INPUT, name: "Hook", prompt: "x", cron: "", enabled: true });
    expect(off.nextRunAt).toBeNull(); // webhook only
  });

  it("recomputes the next run when cron or enabled change and resets a paused schedule", async () => {
    const row = await seed();
    row.lastStatus = "paused";
    row.enabled = false;
    row.failStreak = 3;
    row.nextRunAt = null;
    const on = await updateSchedule(row.id, { enabled: true });
    expect(on?.nextRunAt).not.toBeNull();
    expect(on?.failStreak).toBe(0);
    expect(on?.lastStatus).toBe("");
    const off = await updateSchedule(row.id, { enabled: false });
    expect(off?.nextRunAt).toBeNull();
    const renamed = await updateSchedule(row.id, { name: "Other" });
    expect(renamed?.nextRunAt).toBeNull(); // untouched
    expect(await updateSchedule("nope", { name: "x" })).toBeNull();
  });

  it("computeNextRun handles empty and broken expressions", () => {
    expect(computeNextRun("", NOW)).toBeNull();
    expect(computeNextRun("nope", NOW)).toBeNull();
    expect(computeNextRun("0 2 * * *", NOW)).toEqual(new Date(2026, 9, 15, 2, 0));
  });
});

describe("fireSchedule", () => {
  it("starts a turn with the schedule block, records the run and advances the cron time", async () => {
    const row = await seed();
    const r = await fireSchedule(row, { reason: "cron", now: NOW });
    expect(r.started).toBe(true);
    expect(state.launches).toHaveLength(1);
    expect(state.launches[0]).toMatchObject({ kind: "turn", origin: "schedule", title: "[schedule] Nightly" });
    expect(state.launches[0].userMessage?.content).toBe("Run the tests."); // the transcript shows the task, not the block
    expect(JSON.parse(state.launches[0].userMessage!.meta!)).toEqual({ schedule: { id: row.id, name: "Nightly", reason: "cron", run: 1 } });
    await flush();
    expect(state.turns[0].prompt).toContain('schedule "Nightly" (run #1, cron "0 2 * * *"');
    expect(state.turns[0].prompt.endsWith("Run the tests.")).toBe(true);
    expect(state.turns[0].opts).toMatchObject({ interactive: true, useKnowledge: false });
    expect(row.runCount).toBe(1);
    expect(row.lastStatus).toBe("running");
    expect(row.nextRunAt).toEqual(new Date(2026, 9, 15, 2, 0));
  });

  it("runs loops and orchestrations with the matching origin", async () => {
    const loop = await seed({ mode: "loop", loop: { ...DEFAULT_SCHEDULE_INPUT.loop, maxIterations: 3 } });
    const r1 = await fireSchedule(loop, { reason: "webhook", payload: '{"ref":"main"}', now: NOW });
    expect(r1.started).toBe(true);
    expect(state.loops[0].origin).toBe("webhook");
    expect(state.loops[0].cfg.maxIterations).toBe(3);
    expect(String(state.loops[0].cfg.prompt)).toContain('<trigger_payload>\n{"ref":"main"}');
    expect(state.loops[0].opts).toMatchObject({ display: "Run the tests." });
    expect(loop.nextRunAt).toEqual(computeNextRun("0 2 * * *")); // a webhook run does not move the cron slot
    state.finish[0]("idle");

    const orch = await seed({ mode: "orchestrate" });
    const r2 = await fireSchedule(orch, { reason: "manual", now: NOW });
    expect(r2.started).toBe(true);
    expect(state.launches[0]).toMatchObject({ kind: "orchestrate", origin: "schedule" });
  });

  it("refuses busy sessions, missing sessions, bad folders and disabled webhooks", async () => {
    const row = await seed();
    state.busy.add("s1");
    expect(await fireSchedule(row, { reason: "cron" })).toMatchObject({ started: false, reason: "busy" });
    state.busy.delete("s1");
    state.sessions.set("s1", { ...state.sessions.get("s1")!, cwd: "/gone" });
    expect(await fireSchedule(row, { reason: "cron" })).toMatchObject({ started: false, reason: "invalid_cwd" });
    state.sessions.delete("s1");
    expect(await fireSchedule(row, { reason: "cron" })).toMatchObject({ started: false, reason: "session_missing" });
    row.enabled = false;
    expect(await fireSchedule(row, { reason: "webhook", requireEnabled: true })).toMatchObject({ started: false, reason: "disabled" });
    expect(state.launches).toHaveLength(0);
  });

  it("onlyIfChanged skips cron runs while the working tree fingerprint is unchanged — manual runs always go", async () => {
    state.fingerprint = "abc";
    const fp = await workdirFingerprint("/apps/shop");
    const row = await seed({ onlyIfChanged: true });
    row.lastFingerprint = fp ?? "";
    expect(await fireSchedule(row, { reason: "cron", now: NOW })).toMatchObject({ started: false, reason: "unchanged" });
    expect(await fireSchedule(row, { reason: "manual", now: NOW })).toMatchObject({ started: true });
    state.fingerprint = "def";
    state.finish[0]("idle");
    const r = await fireSchedule(row, { reason: "cron", now: NOW });
    expect(r).toMatchObject({ started: true });
  });
});

describe("finishRun", () => {
  it("stores the outcome and the report, measures the fingerprint and notifies", async () => {
    state.fingerprint = "head1";
    const row = await seed({ onlyIfChanged: true, notifyTelegram: true });
    const startedAt = NOW;
    state.messages.push({ sessionId: "s1", role: "assistant", content: "## Alle Tests grün\nNichts zu tun.", createdAt: new Date(NOW + 10) });
    await finishRun(row.id, { id: "s1", title: "Shop", cwd: "/apps/shop", provider: "claude" }, startedAt, "idle");
    expect(row.lastStatus).toBe("done");
    expect(row.lastSummary).toContain("Alle Tests grün");
    expect(row.lastFingerprint).toBe(await workdirFingerprint("/apps/shop"));
    expect(row.failStreak).toBe(0);
    expect(state.pushes[0]).toMatchObject({ title: "Zeitplan „Nightly“: Abgeschlossen", body: "Alle Tests grün\nShop" });
    expect(state.telegrams[0]).toContain("⏰ Zeitplan „Nightly“: Abgeschlossen");
    expect(state.telegrams[0]).toContain("Nichts zu tun.");
  });

  it("pauses after three failed runs in a row and disables after maxRuns", async () => {
    const row = await seed({ notifyPush: false });
    row.failStreak = 2;
    await finishRun(row.id, { id: "s1", title: "Shop", cwd: "/apps/shop", provider: "claude" }, NOW, "error");
    expect(row).toMatchObject({ lastStatus: "paused", enabled: false, nextRunAt: null, failStreak: 3 });

    const capped = await seed({ maxRuns: 2 });
    capped.runCount = 2;
    await finishRun(capped.id, { id: "s1", title: "Shop", cwd: "/apps/shop", provider: "claude" }, NOW, "idle");
    expect(capped).toMatchObject({ lastStatus: "done", enabled: false });
    expect(state.pushes.at(-1)?.title).toContain("Maximum erreicht");
  });

  it("ignores a schedule deleted while it ran", async () => {
    await expect(finishRun("gone", { id: "s1", title: "", cwd: "/x", provider: "claude" }, NOW, "idle")).resolves.toBeUndefined();
  });
});

describe("tickSchedules", () => {
  it("fires due schedules, skips or waits on busy sessions, moves stalled ones on", async () => {
    const due = await seed({ name: "Due" });
    due.nextRunAt = new Date(NOW - 1000);
    const later = await seed({ name: "Later" });
    later.nextRunAt = new Date(NOW + 60_000);
    await tickSchedules(NOW);
    expect(state.launches.map((l) => l.title)).toEqual(["[schedule] Due"]);
    expect(later.lastStatus).toBe("");

    state.finish[0]("idle");
    state.busy.add("s1");
    const skip = await seed({ name: "Skip", onBusy: "skip" });
    skip.nextRunAt = new Date(NOW - 1);
    const wait = await seed({ name: "Wait", onBusy: "wait" });
    wait.nextRunAt = new Date(NOW - 1);
    await tickSchedules(NOW);
    expect(skip.lastStatus).toBe("skipped");
    expect(skip.nextRunAt).toEqual(new Date(2026, 9, 15, 2, 0));
    expect(wait.lastStatus).toBe("");
    expect(wait.nextRunAt).toEqual(new Date(NOW - 1)); // still due
    state.busy.delete("s1");
    await tickSchedules(NOW);
    expect(wait.lastStatus).toBe("running");
    expect(state.launches.map((l) => l.title)).toEqual(["[schedule] Due", "[schedule] Wait"]);
  });

  it("counts a session that is gone as a failure and pauses after three", async () => {
    const row = await seed({ name: "Orphan" });
    row.nextRunAt = new Date(NOW - 1);
    row.failStreak = 2;
    state.sessions.delete("s1");
    await tickSchedules(NOW);
    expect(row).toMatchObject({ lastStatus: "paused", enabled: false, nextRunAt: null });
    expect(row.lastSummary).toContain("Session");
  });

  it("unchanged working trees are noted and rescheduled", async () => {
    state.fingerprint = "same";
    const row = await seed({ name: "Rev", onlyIfChanged: true });
    row.lastFingerprint = (await workdirFingerprint("/apps/shop")) ?? "";
    row.nextRunAt = new Date(NOW - 1);
    await tickSchedules(NOW);
    expect(row.lastStatus).toBe("unchanged");
    expect(row.nextRunAt).toEqual(new Date(2026, 9, 15, 2, 0));
    expect(state.launches).toHaveLength(0);
  });
});

describe("headlineOf", () => {
  it("takes the first non-empty line without heading marks", () => {
    expect(headlineOf("\n\n### Build ok\nmore")).toBe("Build ok");
    expect(headlineOf("**Fertig.**")).toBe("Fertig.");
    expect(headlineOf("")).toBe("");
  });
});
