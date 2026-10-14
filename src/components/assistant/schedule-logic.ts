// Pure helpers of the schedule UI (panel, editor sheet, home widget): rhythm
// and next-run wording, the editor's rhythm choice, body normalisation and the
// one-line summary. Unit-tested; no React.
import type { BadgeVariant } from "@/components/ui/badge";
import { runKindLabel } from "@/lib/labels";
import { CRON_PRESETS, describeCron, isValidCron } from "@/lib/schedule/cron";
import { DEFAULT_SCHEDULE_INPUT, triggerPath, type ScheduleInput, type ScheduleStatus, type ScheduleView } from "@/lib/schedule/types";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const MONTHS = ["Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sep.", "Okt.", "Nov.", "Dez."];
const pad2 = (n: number) => String(n).padStart(2, "0");

function toMs(input: Date | number | string): number {
  if (input instanceof Date) return input.getTime();
  if (typeof input === "number") return input;
  return Date.parse(input);
}

function calendarDays(from: number, to: number): number {
  const a = new Date(from);
  const b = new Date(to);
  a.setHours(0, 0, 0, 0);
  b.setHours(0, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / (24 * HOUR));
}

/**
 * A future instant relative to `now`: "jetzt" · "in 3 Min." · "in 2 Std." ·
 * "morgen 02:00" · "Fr 09:00" · "17. Okt. 09:00". Past instants read "jetzt".
 */
export function formatUntil(input: Date | number | string, now: number): string {
  const t = toMs(input);
  if (!Number.isFinite(t)) return "–";
  const diff = t - now;
  if (diff < MINUTE) return "jetzt";
  if (diff < HOUR) return `in ${Math.floor(diff / MINUTE)} Min.`;
  const d = new Date(t);
  const clock = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const days = calendarDays(now, t);
  if (days === 0 || diff < 6 * HOUR) return `in ${Math.floor(diff / HOUR)} Std.`;
  if (days === 1) return `morgen ${clock}`;
  if (days < 7) return `${WEEKDAYS[d.getDay()]} ${clock}`;
  return `${d.getDate()}. ${MONTHS[d.getMonth()]} ${clock}`;
}

/** "Werktags um 09:00" · "Nur per Webhook". */
export function rhythmLabel(s: Pick<ScheduleView, "cron">): string {
  if (!s.cron.trim()) return "Nur per Webhook";
  return describeCron(s.cron) || `Cron: ${s.cron}`;
}

/** The next-run line of a schedule row. */
export function nextRunLabel(s: Pick<ScheduleView, "cron" | "enabled" | "nextRunAt" | "lastStatus" | "onBusy">, now: number): string {
  if (s.lastStatus === "running") return "Läuft gerade";
  if (!s.enabled) return s.lastStatus === "paused" ? "Pausiert" : "Aus";
  if (!s.cron.trim()) return "Wartet auf Webhook";
  if (!s.nextRunAt) return "Kein nächster Termin";
  const t = toMs(s.nextRunAt);
  if (Number.isFinite(t) && t <= now) return s.onBusy === "wait" ? "Wartet auf freie Session" : "Startet gleich";
  return `Nächster Lauf ${formatUntil(t, now)}`;
}

export function statusTone(status: ScheduleStatus | string): BadgeVariant {
  switch (status) {
    case "done":
      return "success";
    case "running":
      return "brand";
    case "error":
    case "paused":
      return "danger";
    case "skipped":
    case "unchanged":
    case "stopped":
      return "warning";
    default:
      return "neutral";
  }
}

/** Absolute webhook URL for display and copying. */
export function webhookUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}${triggerPath(token)}`;
}

// --- Editor ------------------------------------------------------------------------

/** The rhythm select: a preset's cron, "custom" (free expression) or "none" (webhook only). */
export type RhythmChoice = "none" | "custom" | string;

export const RHYTHM_NONE: RhythmChoice = "none";
export const RHYTHM_CUSTOM: RhythmChoice = "custom";

export function rhythmChoiceFor(cron: string): RhythmChoice {
  const c = cron.trim();
  if (!c) return RHYTHM_NONE;
  return CRON_PRESETS.some((p) => p.cron === c) ? c : RHYTHM_CUSTOM;
}

export function rhythmOptions(): { value: string; label: string }[] {
  return [
    ...CRON_PRESETS.map((p) => ({ value: p.cron, label: p.label })),
    { value: RHYTHM_CUSTOM, label: "Eigener Cron-Ausdruck …" },
    { value: RHYTHM_NONE, label: "Kein Zeitplan – nur per Webhook" },
  ];
}

/** What the editor holds; `maxRuns` as typed. */
export interface ScheduleDraft extends Omit<ScheduleInput, "maxRuns"> {
  maxRuns: string;
}

export function draftFrom(initial: Partial<ScheduleInput> = {}): ScheduleDraft {
  const base = { ...DEFAULT_SCHEDULE_INPUT, ...initial, loop: { ...DEFAULT_SCHEDULE_INPUT.loop, ...initial.loop } };
  return { ...base, maxRuns: base.maxRuns == null ? "" : String(base.maxRuns) };
}

/** Why the draft cannot be saved (null = fine). */
export function draftProblem(d: ScheduleDraft): string | null {
  if (!d.name.trim()) return "Erst einen Namen eingeben.";
  if (!d.prompt.trim()) return "Erst die Aufgabe beschreiben.";
  if (d.cron.trim() && !isValidCron(d.cron)) return "Der Cron-Ausdruck ist ungültig.";
  const n = d.maxRuns.trim();
  if (n && !(/^\d+$/.test(n) && Number(n) >= 1)) return "Max. Läufe muss eine Zahl ab 1 sein.";
  return null;
}

/** The request body for POST/PATCH. */
export function draftToInput(d: ScheduleDraft): ScheduleInput {
  const n = d.maxRuns.trim();
  return {
    name: d.name.trim().slice(0, 80),
    prompt: d.prompt.trim(),
    cron: d.cron.trim(),
    mode: d.mode,
    loop: d.loop,
    useKnowledge: d.useKnowledge,
    onBusy: d.onBusy,
    onlyIfChanged: d.onlyIfChanged,
    notifyPush: d.notifyPush,
    notifyTelegram: d.notifyTelegram,
    maxRuns: n ? Math.max(1, Math.floor(Number(n))) : null,
    enabled: d.enabled,
  };
}

/** "Werktags um 09:00 · Direkt · nur bei Änderungen · Push". */
export function scheduleSummary(i: Pick<ScheduleInput, "cron" | "mode" | "onlyIfChanged" | "notifyPush" | "notifyTelegram">): string {
  const parts = [rhythmLabel(i), runKindLabel(i.mode)];
  if (i.onlyIfChanged && i.cron.trim()) parts.push("nur bei Änderungen");
  const notify = [i.notifyPush ? "Push" : "", i.notifyTelegram ? "Telegram" : ""].filter(Boolean);
  parts.push(notify.length ? notify.join(" + ") : "ohne Benachrichtigung");
  return parts.join(" · ");
}

/** Enabled schedules first by next run (webhook-only last), then the rest. */
export function sortSchedules<T extends Pick<ScheduleView, "enabled" | "nextRunAt" | "name">>(list: T[]): T[] {
  const key = (s: T) => {
    if (!s.enabled) return Number.POSITIVE_INFINITY;
    if (!s.nextRunAt) return Number.MAX_SAFE_INTEGER;
    const t = toMs(s.nextRunAt);
    return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
  };
  return [...list].sort((a, b) => key(a) - key(b) || a.name.localeCompare(b.name, "de"));
}
