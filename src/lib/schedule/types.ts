// Client-safe types and labels of session schedules (no server imports).
// The server shape lives in prisma/schema.prisma (SessionSchedule).

export type ScheduleMode = "turn" | "loop" | "orchestrate";
export type ScheduleOnBusy = "skip" | "wait";
/** What started a run of the schedule. */
export type ScheduleFireReason = "cron" | "manual" | "webhook";

export interface ScheduleLoopOptions {
  maxIterations: number;
  completionPromise: string;
  intervalSec: number;
  freshContext: boolean;
  stopOnError: boolean;
}

export const DEFAULT_SCHEDULE_LOOP: ScheduleLoopOptions = {
  maxIterations: 10,
  completionPromise: "DONE",
  intervalSec: 0,
  freshContext: false,
  stopOnError: true,
};

/** The fields the user edits (body of POST / PATCH). */
export interface ScheduleInput {
  name: string;
  prompt: string;
  /** 5-field cron in server local time; "" = webhook only. */
  cron: string;
  mode: ScheduleMode;
  loop: ScheduleLoopOptions;
  useKnowledge: boolean;
  onBusy: ScheduleOnBusy;
  onlyIfChanged: boolean;
  notifyPush: boolean;
  notifyTelegram: boolean;
  maxRuns: number | null;
  enabled: boolean;
}

export const DEFAULT_SCHEDULE_INPUT: ScheduleInput = {
  name: "",
  prompt: "",
  cron: "0 9 * * 1-5",
  mode: "turn",
  loop: DEFAULT_SCHEDULE_LOOP,
  useKnowledge: false,
  onBusy: "skip",
  onlyIfChanged: false,
  notifyPush: true,
  notifyTelegram: false,
  maxRuns: null,
  enabled: true,
};

/** Outcome of the last run as the scheduler recorded it ("" = never ran). */
export type ScheduleStatus = "" | "running" | "done" | "error" | "stopped" | "skipped" | "unchanged" | "paused";

/** A schedule as the API returns it. */
export interface ScheduleView extends ScheduleInput {
  id: string;
  sessionId: string;
  /** Secret of the webhook URL (POST /api/assistant/schedules/trigger/[token]). */
  triggerToken: string;
  runCount: number;
  failStreak: number;
  lastRunAt: string | null;
  lastStatus: ScheduleStatus;
  lastSummary: string;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Present on the global list (home widget). */
  session?: { title: string; cwd: string; provider: string };
}

export const SCHEDULE_STATUS_LABEL: Record<ScheduleStatus, string> = {
  "": "Noch nie gelaufen",
  running: "Läuft",
  done: "Abgeschlossen",
  error: "Fehler",
  stopped: "Gestoppt",
  skipped: "Übersprungen – Session war beschäftigt",
  unchanged: "Übersprungen – keine Änderungen",
  paused: "Pausiert nach wiederholten Fehlern",
};

export const SCHEDULE_ON_BUSY_LABEL: Record<ScheduleOnBusy, string> = {
  skip: "Überspringen",
  wait: "Warten, bis die Session frei ist",
};

/** Consecutive failed runs after which a schedule pauses itself. */
export const SCHEDULE_FAIL_PAUSE = 3;

/** Longest webhook body handed to the agent (characters). */
export const SCHEDULE_PAYLOAD_MAX = 8_000;

export function scheduleStatusLabel(s: string): string {
  return Object.prototype.hasOwnProperty.call(SCHEDULE_STATUS_LABEL, s) ? SCHEDULE_STATUS_LABEL[s as ScheduleStatus] : s;
}

/** The webhook URL of a schedule, relative to the app's origin. */
export function triggerPath(token: string): string {
  return `/api/assistant/schedules/trigger/${encodeURIComponent(token)}`;
}
