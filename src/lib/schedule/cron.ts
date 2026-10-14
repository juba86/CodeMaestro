// Five-field cron expressions ("minute hour day-of-month month day-of-week")
// for session schedules, evaluated in the server's local time. Supports `*`,
// lists, ranges, steps (`*/15`, `1-5/2`) and English names for months and
// weekdays; Sunday is 0 or 7. As in cron, a restricted day-of-month and a
// restricted day-of-week match when EITHER does. Client-safe (no Node APIs).

export interface CronSpec {
  minutes: Set<number>;
  hours: Set<number>;
  days: Set<number>;
  months: Set<number>;
  weekdays: Set<number>;
  /** Day-of-month / day-of-week were given explicitly (not `*`). */
  dayRestricted: boolean;
  weekdayRestricted: boolean;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export class CronError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CronError";
  }
}

function parseNumber(token: string, names: string[] | null, offset: number): number {
  const t = token.trim().toLowerCase();
  if (names) {
    const i = names.indexOf(t.slice(0, 3));
    if (i >= 0 && t.length === 3) return i + offset;
  }
  if (!/^\d+$/.test(t)) throw new CronError(`Ungültiger Wert „${token}“.`);
  return Number(t);
}

function parseField(field: string, min: number, max: number, names: string[] | null, nameOffset: number): { values: Set<number>; star: boolean } {
  const values = new Set<number>();
  let star = false;
  for (const part of field.split(",")) {
    const [rangePart, stepPart, ...rest] = part.split("/");
    if (rest.length || rangePart === "" || stepPart === "") throw new CronError(`Ungültiges Feld „${field}“.`);
    const step = stepPart === undefined ? 1 : parseNumber(stepPart, null, 0);
    if (step < 1) throw new CronError(`Schrittweite in „${field}“ muss mindestens 1 sein.`);
    let lo: number;
    let hi: number;
    if (rangePart === "*") {
      lo = min;
      hi = max;
      if (stepPart === undefined) star = true;
    } else if (rangePart.includes("-")) {
      const [a, b, ...more] = rangePart.split("-");
      if (more.length || a === "" || b === "") throw new CronError(`Ungültiger Bereich „${rangePart}“.`);
      lo = parseNumber(a, names, nameOffset);
      hi = parseNumber(b, names, nameOffset);
      if (lo > hi) throw new CronError(`Bereich „${rangePart}“ ist verkehrt herum.`);
    } else {
      lo = parseNumber(rangePart, names, nameOffset);
      hi = stepPart === undefined ? lo : max;
    }
    if (lo < min || hi > max) throw new CronError(`„${rangePart}“ liegt außerhalb von ${min}–${max}.`);
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return { values, star };
}

/** Parses a 5-field expression; throws CronError with a German message. */
export function parseCron(expr: string): CronSpec {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5 || !expr.trim()) {
    throw new CronError("Ein Cron-Ausdruck hat fünf Felder: Minute Stunde Tag Monat Wochentag.");
  }
  const [m, h, d, mo, w] = fields;
  const minutes = parseField(m, 0, 59, null, 0);
  const hours = parseField(h, 0, 23, null, 0);
  const days = parseField(d, 1, 31, null, 0);
  const months = parseField(mo, 1, 12, MONTHS, 1);
  const weekdays = parseField(w, 0, 7, WEEKDAYS, 0);
  if (weekdays.values.has(7)) {
    weekdays.values.delete(7);
    weekdays.values.add(0);
  }
  return {
    minutes: minutes.values,
    hours: hours.values,
    days: days.values,
    months: months.values,
    weekdays: weekdays.values,
    dayRestricted: !days.star,
    weekdayRestricted: !weekdays.star,
  };
}

/** True when the expression parses. */
export function isValidCron(expr: string): boolean {
  try {
    parseCron(expr);
    return true;
  } catch {
    return false;
  }
}

function dayMatches(spec: CronSpec, date: Date): boolean {
  if (!spec.months.has(date.getMonth() + 1)) return false;
  const dom = spec.days.has(date.getDate());
  const dow = spec.weekdays.has(date.getDay());
  if (spec.dayRestricted && spec.weekdayRestricted) return dom || dow;
  if (spec.dayRestricted) return dom;
  if (spec.weekdayRestricted) return dow;
  return true;
}

// A schedule that matches nothing (e.g. "0 0 31 2 *") must not spin forever.
const MAX_DAYS_AHEAD = 366 * 4 + 1;

/**
 * The first time strictly after `from` (local time, seconds dropped) the
 * expression matches, or null when nothing matches within four years.
 */
export function nextCronRun(spec: CronSpec | string, from: Date | number = Date.now()): Date | null {
  const s = typeof spec === "string" ? parseCron(spec) : spec;
  const t = new Date(from);
  t.setSeconds(0, 0);
  t.setMinutes(t.getMinutes() + 1);
  const limit = new Date(t.getTime());
  limit.setDate(limit.getDate() + MAX_DAYS_AHEAD);

  while (t < limit) {
    if (!dayMatches(s, t)) {
      t.setDate(t.getDate() + 1);
      t.setHours(0, 0, 0, 0);
      continue;
    }
    if (!s.hours.has(t.getHours())) {
      t.setHours(t.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!s.minutes.has(t.getMinutes())) {
      t.setMinutes(t.getMinutes() + 1, 0, 0);
      continue;
    }
    return t;
  }
  return null;
}

/** The next `n` run times after `from` (helps the editor show what an expression means). */
export function nextCronRuns(expr: string, n: number, from: Date | number = Date.now()): Date[] {
  const spec = parseCron(expr);
  const out: Date[] = [];
  let cursor: Date | number = from;
  for (let i = 0; i < n; i++) {
    const next = nextCronRun(spec, cursor);
    if (!next) break;
    out.push(next);
    cursor = next;
  }
  return out;
}

// --- German description -------------------------------------------------------

const DAY_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const DAY_LONG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

const pad = (n: number) => String(n).padStart(2, "0");

function single(set: Set<number>): number | null {
  return set.size === 1 ? [...set][0] : null;
}

// A star with a step over the whole range ("*" "/" n) → n, else null.
function stepOf(field: string, max: number): number | null {
  const f = field.trim();
  if (f === "*") return 1;
  const m = /^\*\/(\d+)$/.exec(f);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= max ? n : null;
}

/**
 * "Alle 15 Minuten", "Täglich um 09:00", "Werktags um 18:30", "Jeden Montag
 * um 09:00", "Am 1. jedes Monats um 08:00" — or the raw expression for shapes
 * without a short German form. Invalid expressions return "".
 */
export function describeCron(expr: string): string {
  let spec: CronSpec;
  try {
    spec = parseCron(expr);
  } catch {
    return "";
  }
  const [mField, hField] = expr.trim().split(/\s+/);
  const allMonths = spec.months.size === 12;
  const minute = single(spec.minutes);
  const hour = single(spec.hours);
  const time = minute !== null && hour !== null ? `${pad(hour)}:${pad(minute)}` : null;

  const minuteStep = stepOf(mField, 59);
  if (minuteStep !== null && spec.hours.size === 24 && !spec.dayRestricted && !spec.weekdayRestricted && allMonths) {
    return minuteStep === 1 ? "Jede Minute" : `Alle ${minuteStep} Minuten`;
  }
  const hourStep = stepOf(hField, 23);
  if (minute !== null && hourStep !== null && !spec.dayRestricted && !spec.weekdayRestricted && allMonths) {
    const suffix = minute ? ` (Minute ${minute})` : "";
    return hourStep === 1 ? `Stündlich${suffix}` : `Alle ${hourStep} Stunden${suffix}`;
  }
  if (minute !== null && spec.hours.size === 24 && !spec.dayRestricted && !spec.weekdayRestricted && allMonths) {
    return minute ? `Stündlich (Minute ${minute})` : "Stündlich";
  }
  if (!time || !allMonths) return `Cron: ${expr.trim()}`;

  if (!spec.dayRestricted && !spec.weekdayRestricted) return `Täglich um ${time}`;
  if (spec.weekdayRestricted && !spec.dayRestricted) {
    const days = [...spec.weekdays].sort((a, b) => a - b);
    const key = days.join(",");
    if (key === "1,2,3,4,5") return `Werktags um ${time}`;
    if (key === "0,6") return `Am Wochenende um ${time}`;
    if (days.length === 1) return `Jeden ${DAY_LONG[days[0]]} um ${time}`;
    // Monday first.
    const ordered = [...days.filter((d) => d !== 0), ...days.filter((d) => d === 0)];
    return `${ordered.map((d) => DAY_SHORT[d]).join(", ")} um ${time}`;
  }
  if (spec.dayRestricted && !spec.weekdayRestricted) {
    const days = [...spec.days].sort((a, b) => a - b);
    if (days.length === 1) return `Am ${days[0]}. jedes Monats um ${time}`;
    return `Am ${days.map((d) => `${d}.`).join(", ")} jedes Monats um ${time}`;
  }
  return `Cron: ${expr.trim()}`;
}

/** Rhythms offered in the editor; "custom" keeps whatever the user typed. */
export const CRON_PRESETS: { cron: string; label: string }[] = [
  { cron: "*/15 * * * *", label: "Alle 15 Minuten" },
  { cron: "0 * * * *", label: "Stündlich" },
  { cron: "0 */4 * * *", label: "Alle 4 Stunden" },
  { cron: "0 9 * * *", label: "Täglich um 09:00" },
  { cron: "0 22 * * *", label: "Täglich um 22:00" },
  { cron: "0 9 * * 1-5", label: "Werktags um 09:00" },
  { cron: "0 18 * * 1-5", label: "Werktags um 18:00" },
  { cron: "0 9 * * 1", label: "Montags um 09:00" },
  { cron: "0 2 * * *", label: "Nachts um 02:00" },
];
