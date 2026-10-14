// Session schedules: a task the session runs on its own — on a cron rhythm,
// by webhook, or by hand — as an ordinary hub run (turn, loop or orchestration)
// with origin "schedule" / "webhook". This module owns the rows, starts the
// runs and records their outcome; scheduler.ts only ticks.

import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/db/client";
import { startLoopRun } from "@/lib/assistant/loop";
import { resolveOrchestra } from "@/lib/assistant/orchestra";
import { orchestrateRun } from "@/lib/assistant/orchestrator";
import { SessionBusyError, isSessionBusy, type RunEndStatus, type RunHandle, type RunOrigin } from "@/lib/assistant/run-hub";
import { resolveWorkdir } from "@/lib/assistant/security";
import { executeTurn, launchRun, toSessionRow } from "@/lib/assistant/session-run";
import { notifyTelegramChats } from "@/lib/assistant/telegram";
import { snapshotWorkdir } from "@/lib/assistant/workdir-changes";
import { sendPush } from "@/lib/push";
import { nextCronRun } from "./cron";
import { schedulePrompt } from "./prompt";
import {
  DEFAULT_SCHEDULE_LOOP,
  SCHEDULE_FAIL_PAUSE,
  scheduleStatusLabel,
  type ScheduleFireReason,
  type ScheduleInput,
  type ScheduleLoopOptions,
  type ScheduleStatus,
  type ScheduleView,
} from "./types";

export type ScheduleRow = NonNullable<Awaited<ReturnType<typeof prisma.sessionSchedule.findUnique>>>;
type SessionFacts = { title: string; cwd: string; provider: string };

const SUMMARY_MAX = 600;
const TELEGRAM_REPORT_MAX = 1500;
// How many due schedules one tick handles (the rest wait for the next tick).
const TICK_BATCH = 50;

export function newTriggerToken(): string {
  return randomBytes(24).toString("base64url");
}

/** The next cron time after `from`, or null without a cron (webhook only) or when nothing matches. */
export function computeNextRun(cron: string, from: number = Date.now()): Date | null {
  if (!cron.trim()) return null;
  try {
    return nextCronRun(cron, from);
  } catch {
    return null;
  }
}

export function parseLoopOptions(json: string): ScheduleLoopOptions {
  try {
    const v = JSON.parse(json || "{}") as Partial<ScheduleLoopOptions>;
    return { ...DEFAULT_SCHEDULE_LOOP, ...(v && typeof v === "object" ? v : {}) };
  } catch {
    return { ...DEFAULT_SCHEDULE_LOOP };
  }
}

export function toView(row: ScheduleRow, session?: SessionFacts | null): ScheduleView {
  return {
    id: row.id,
    sessionId: row.sessionId,
    name: row.name,
    prompt: row.prompt,
    cron: row.cron,
    mode: row.mode as ScheduleView["mode"],
    loop: parseLoopOptions(row.loop),
    useKnowledge: row.useKnowledge,
    onBusy: row.onBusy as ScheduleView["onBusy"],
    onlyIfChanged: row.onlyIfChanged,
    notifyPush: row.notifyPush,
    notifyTelegram: row.notifyTelegram,
    maxRuns: row.maxRuns,
    enabled: row.enabled,
    triggerToken: row.triggerToken,
    runCount: row.runCount,
    failStreak: row.failStreak,
    lastRunAt: row.lastRunAt ? row.lastRunAt.toISOString() : null,
    lastStatus: row.lastStatus as ScheduleStatus,
    lastSummary: row.lastSummary,
    nextRunAt: row.nextRunAt ? row.nextRunAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(session ? { session: { title: session.title || session.cwd, cwd: session.cwd, provider: session.provider } } : {}),
  };
}

const SESSION_SELECT = { select: { title: true, cwd: true, provider: true } } as const;

/** All schedules (newest first), or those of one session. */
export async function listSchedules(sessionId?: string): Promise<ScheduleView[]> {
  const rows = await prisma.sessionSchedule.findMany({
    where: sessionId ? { sessionId } : undefined,
    orderBy: { createdAt: "desc" },
    include: { session: SESSION_SELECT },
  });
  return rows.map((r) => toView(r, r.session));
}

export async function createSchedule(sessionId: string, input: ScheduleInput): Promise<ScheduleView> {
  const row = await prisma.sessionSchedule.create({
    data: {
      sessionId,
      name: input.name,
      prompt: input.prompt,
      cron: input.cron,
      mode: input.mode,
      loop: JSON.stringify(input.loop),
      useKnowledge: input.useKnowledge,
      onBusy: input.onBusy,
      onlyIfChanged: input.onlyIfChanged,
      notifyPush: input.notifyPush,
      notifyTelegram: input.notifyTelegram,
      maxRuns: input.maxRuns,
      enabled: input.enabled,
      triggerToken: newTriggerToken(),
      nextRunAt: input.enabled ? computeNextRun(input.cron) : null,
    },
    include: { session: SESSION_SELECT },
  });
  return toView(row, row.session);
}

/** Applies a partial update; the next run is recomputed when cron or enabled changed. */
export async function updateSchedule(id: string, patch: Partial<ScheduleInput>): Promise<ScheduleView | null> {
  const current = await prisma.sessionSchedule.findUnique({ where: { id } });
  if (!current) return null;
  const cron = patch.cron ?? current.cron;
  const enabled = patch.enabled ?? current.enabled;
  const rescheduled = patch.cron !== undefined || patch.enabled !== undefined;
  const row = await prisma.sessionSchedule.update({
    where: { id },
    data: {
      ...fieldsOf(patch),
      ...(rescheduled ? { nextRunAt: enabled ? computeNextRun(cron) : null } : {}),
      // Switching a paused schedule back on gives it a clean slate.
      ...(patch.enabled && !current.enabled ? { failStreak: 0, ...(current.lastStatus === "paused" ? { lastStatus: "" } : {}) } : {}),
    },
    include: { session: SESSION_SELECT },
  });
  return toView(row, row.session);
}

export async function deleteSchedule(id: string): Promise<boolean> {
  try {
    await prisma.sessionSchedule.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}

function fieldsOf(i: Partial<ScheduleInput>) {
  return {
    ...(i.name !== undefined ? { name: i.name } : {}),
    ...(i.prompt !== undefined ? { prompt: i.prompt } : {}),
    ...(i.cron !== undefined ? { cron: i.cron } : {}),
    ...(i.mode !== undefined ? { mode: i.mode } : {}),
    ...(i.loop !== undefined ? { loop: JSON.stringify(i.loop) } : {}),
    ...(i.useKnowledge !== undefined ? { useKnowledge: i.useKnowledge } : {}),
    ...(i.onBusy !== undefined ? { onBusy: i.onBusy } : {}),
    ...(i.onlyIfChanged !== undefined ? { onlyIfChanged: i.onlyIfChanged } : {}),
    ...(i.notifyPush !== undefined ? { notifyPush: i.notifyPush } : {}),
    ...(i.notifyTelegram !== undefined ? { notifyTelegram: i.notifyTelegram } : {}),
    ...(i.maxRuns !== undefined ? { maxRuns: i.maxRuns } : {}),
    ...(i.enabled !== undefined ? { enabled: i.enabled } : {}),
  };
}

// --- Working-tree fingerprint (onlyIfChanged) ----------------------------------------

/** HEAD plus the dirty files' markers, hashed; null outside a git repository. */
export async function workdirFingerprint(cwd: string): Promise<string | null> {
  const snap = await snapshotWorkdir(cwd).catch(() => null);
  if (!snap) return null;
  const dirty = [...snap.dirty.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([f, m]) => `${f}:${m}`);
  return createHash("sha1").update(`${snap.head}\n${dirty.join("\n")}`).digest("hex");
}

// --- Firing ------------------------------------------------------------------------------

export type FireFailure = "busy" | "disabled" | "unchanged" | "session_missing" | "invalid_cwd" | "error";

export type FireResult = { started: true; runId: string } | { started: false; reason: FireFailure; message: string };

const FAILURE_MESSAGE: Record<FireFailure, string> = {
  busy: "In dieser Session läuft gerade etwas.",
  disabled: "Der Zeitplan ist ausgeschaltet.",
  unchanged: "Keine Änderungen im Projekt seit dem letzten Lauf.",
  session_missing: "Die Session des Zeitplans gibt es nicht mehr.",
  invalid_cwd: "Der Projektordner der Session ist nicht erreichbar.",
  error: "Der Lauf konnte nicht gestartet werden.",
};

const fail = (reason: FireFailure, message = FAILURE_MESSAGE[reason]): FireResult => ({ started: false, reason, message });

/**
 * Starts a run for the schedule. Manual and webhook runs ignore `enabled`
 * and `onlyIfChanged` (the user asked for exactly this run); the next cron
 * time only advances for cron runs. The outcome is recorded when the run
 * ends (see finishRun), including notifications.
 */
export async function fireSchedule(
  s: ScheduleRow,
  opts: { reason: ScheduleFireReason; payload?: string; now?: number; requireEnabled?: boolean }
): Promise<FireResult> {
  const now = opts.now ?? Date.now();
  if (opts.requireEnabled && !s.enabled) return fail("disabled");
  const session = await prisma.assistantSession.findUnique({ where: { id: s.sessionId } });
  if (!session) return fail("session_missing");
  if (isSessionBusy(session.id)) return fail("busy");
  try {
    await resolveWorkdir(session.cwd);
  } catch (err) {
    return fail("invalid_cwd", err instanceof Error ? err.message : undefined);
  }
  if (s.onlyIfChanged && opts.reason === "cron") {
    const fp = await workdirFingerprint(session.cwd);
    if (fp !== null && fp === s.lastFingerprint) return fail("unchanged");
  }

  const origin: RunOrigin = opts.reason === "webhook" ? "webhook" : "schedule";
  const runNo = s.runCount + 1;
  const prompt = schedulePrompt({ name: s.name, runNo, reason: opts.reason, cron: s.cron, at: now, payload: opts.payload }, s.prompt);
  const meta = { schedule: { id: s.id, name: s.name, reason: opts.reason, run: runNo } };
  const title = `[schedule] ${s.name}`;

  let handle: RunHandle;
  try {
    if (s.mode === "loop") {
      handle = await startLoopRun(
        session.id,
        { prompt, useKnowledge: s.useKnowledge, ...parseLoopOptions(s.loop) },
        origin,
        { display: s.prompt, meta }
      );
    } else if (s.mode === "orchestrate") {
      const orchestra = await resolveOrchestra();
      const row = toSessionRow(session);
      handle = await launchRun({
        sessionId: session.id,
        kind: "orchestrate",
        origin,
        title,
        userMessage: { content: s.prompt, meta: JSON.stringify(meta) },
        work: (ctx) => orchestrateRun(ctx, row, prompt, { orchestra }),
      });
    } else {
      handle = await launchRun({
        sessionId: session.id,
        kind: "turn",
        origin,
        title,
        userMessage: { content: s.prompt, meta: JSON.stringify(meta) },
        work: (ctx) => executeTurn(ctx, prompt, { useKnowledge: s.useKnowledge, interactive: true }),
      });
    }
  } catch (err) {
    if (err instanceof SessionBusyError) return fail("busy");
    console.error("[schedule] start failed", err);
    return fail("error", err instanceof Error ? err.message : undefined);
  }

  await prisma.sessionSchedule
    .update({
      where: { id: s.id },
      data: {
        lastRunAt: new Date(now),
        lastStatus: "running",
        runCount: { increment: 1 },
        ...(opts.reason === "cron" ? { nextRunAt: computeNextRun(s.cron, now) } : {}),
      },
    })
    .catch((err) => console.error("[schedule] bookkeeping failed", err));

  void handle.finished
    .then((status) => finishRun(s.id, { id: session.id, title: session.title, cwd: session.cwd, provider: session.provider }, handle.info.startedAt, status))
    .catch((err) => console.error("[schedule] finish bookkeeping failed", err));
  return { started: true, runId: handle.info.runId };
}

/** The agent's closing report of a run: the newest summary or assistant text written since `startedAt`. */
async function lastReport(sessionId: string, startedAt: number): Promise<string> {
  const row = await prisma.assistantMessage.findFirst({
    where: { sessionId, role: { in: ["synthesis", "assistant"] }, createdAt: { gte: new Date(startedAt) } },
    orderBy: { createdAt: "desc" },
    select: { content: true },
  });
  return row?.content ?? "";
}

function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** The report's first non-empty line without markdown heading marks. */
export function headlineOf(report: string): string {
  const line = report
    .split("\n")
    .map((l) => l.replace(/^#+\s*/, "").replace(/^\*\*(.+)\*\*$/, "$1").trim())
    .find((l) => l.length > 0);
  return clip(line ?? "", 160);
}

/**
 * Records how a run ended: status and report for the UI, the fingerprint for
 * onlyIfChanged, the fail streak (three in a row pause the schedule), the
 * run cap — then the notifications the schedule asked for.
 */
export async function finishRun(
  scheduleId: string,
  session: { id: string; title: string; cwd: string; provider: string },
  startedAt: number,
  status: RunEndStatus
): Promise<void> {
  const row = await prisma.sessionSchedule.findUnique({ where: { id: scheduleId } });
  if (!row) return; // deleted while it ran
  const report = await lastReport(session.id, startedAt).catch(() => "");
  const fingerprint = row.onlyIfChanged ? await workdirFingerprint(session.cwd) : null;
  const failed = status === "error";
  const failStreak = failed ? row.failStreak + 1 : 0;
  const paused = failed && failStreak >= SCHEDULE_FAIL_PAUSE;
  const exhausted = row.maxRuns !== null && row.runCount >= row.maxRuns;
  const lastStatus: ScheduleStatus = paused ? "paused" : status === "idle" ? "done" : status;
  await prisma.sessionSchedule
    .update({
      where: { id: scheduleId },
      data: {
        lastStatus,
        lastSummary: clip(report, SUMMARY_MAX),
        failStreak,
        ...(fingerprint !== null ? { lastFingerprint: fingerprint } : {}),
        ...(paused || exhausted ? { enabled: false, nextRunAt: null } : {}),
      },
    })
    .catch((err) => console.error("[schedule] result bookkeeping failed", err));

  const sessionLabel = session.title || session.cwd;
  const outcome = exhausted && !paused ? `${scheduleStatusLabel(lastStatus)} · Maximum erreicht, Zeitplan aus` : scheduleStatusLabel(lastStatus);
  const title = `Zeitplan „${row.name}“: ${outcome}`;
  const headline = headlineOf(report);
  if (row.notifyPush) {
    await sendPush(
      { title, body: [headline, sessionLabel].filter(Boolean).join("\n") || "CodeMaestro", url: `/assistant?session=${encodeURIComponent(session.id)}`, tag: `cm-schedule-${row.id}` },
      { ttlSec: 12 * 60 * 60, topic: `cms${row.id}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) }
    ).catch((err) => console.warn("[schedule] push failed", err));
  }
  if (row.notifyTelegram) {
    const body = clip(report, TELEGRAM_REPORT_MAX) || "(kein Bericht)";
    await notifyTelegramChats(`⏰ ${title}\n${sessionLabel}\n\n${body}`);
  }
}

// --- Tick --------------------------------------------------------------------------------

/**
 * Starts every enabled schedule whose time has come. A busy session is
 * skipped (next slot) or waited for (stays due) as the schedule says; a run
 * that cannot start moves on to the next slot so the tick never spins.
 */
export async function tickSchedules(now: number = Date.now()): Promise<void> {
  const due = await prisma.sessionSchedule.findMany({
    where: { enabled: true, nextRunAt: { lte: new Date(now) } },
    orderBy: { nextRunAt: "asc" },
    take: TICK_BATCH,
  });
  for (const s of due) {
    const next = computeNextRun(s.cron, now);
    if (!s.cron) {
      await prisma.sessionSchedule.update({ where: { id: s.id }, data: { nextRunAt: null } }).catch(() => {});
      continue;
    }
    if (isSessionBusy(s.sessionId)) {
      if (s.onBusy === "wait") continue; // stays due; the next tick tries again
      await prisma.sessionSchedule.update({ where: { id: s.id }, data: { lastStatus: "skipped", nextRunAt: next } }).catch(() => {});
      continue;
    }
    const r = await fireSchedule(s, { reason: "cron", now });
    if (r.started) continue;
    if (r.reason === "busy" && s.onBusy === "wait") continue;
    const failed = r.reason === "error" || r.reason === "invalid_cwd" || r.reason === "session_missing";
    const failStreak = failed ? s.failStreak + 1 : 0;
    const paused = failed && failStreak >= SCHEDULE_FAIL_PAUSE;
    await prisma.sessionSchedule
      .update({
        where: { id: s.id },
        data: {
          lastStatus: paused ? "paused" : r.reason === "unchanged" ? "unchanged" : r.reason === "busy" ? "skipped" : "error",
          ...(failed ? { lastSummary: clip(r.message, SUMMARY_MAX), failStreak } : {}),
          ...(paused ? { enabled: false, nextRunAt: null } : { nextRunAt: next }),
        },
      })
      .catch(() => {});
  }
}

/**
 * After a server start: runs that were "running" are gone (CLI processes do
 * not survive a restart), and enabled schedules without a next time get one.
 */
export async function reconcileSchedules(now: number = Date.now()): Promise<void> {
  await prisma.sessionSchedule.updateMany({ where: { lastStatus: "running" }, data: { lastStatus: "stopped" } });
  const stale = await prisma.sessionSchedule.findMany({ where: { enabled: true, nextRunAt: null, NOT: { cron: "" } }, select: { id: true, cron: true } });
  for (const s of stale) {
    await prisma.sessionSchedule.update({ where: { id: s.id }, data: { nextRunAt: computeNextRun(s.cron, now) } }).catch(() => {});
  }
}
