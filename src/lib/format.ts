// German display formatting shared by every page (times, durations, costs,
// counts). Pure and locale-stable: month/weekday names are spelled out here
// instead of relying on the runtime's ICU data, so server, browser and tests
// render identical strings. All calendar maths uses the local time zone.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const MONTHS = ["Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sept.", "Okt.", "Nov.", "Dez."];

function toMs(input: Date | number | string): number {
  if (input instanceof Date) return input.getTime();
  if (typeof input === "number") return input;
  return new Date(input).getTime();
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Whole calendar days between two instants (DST-safe). */
function calendarDaysBetween(earlier: number, later: number): number {
  return Math.round((startOfDay(later) - startOfDay(earlier)) / DAY);
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * "gerade eben" · "vor 8 Min." · "vor 2 Std." · "gestern" · "Mo" · "7. Okt." ·
 * "7. Okt. 2025". Short cross-midnight gaps (< 6h) stay relative instead of
 * jumping to "gestern". Invalid input yields "–".
 */
export function formatRelative(input: Date | number | string, now: number = Date.now()): string {
  const t = toMs(input);
  if (!Number.isFinite(t)) return "–";
  const diff = now - t;

  if (diff > -MINUTE && diff < MINUTE) return "gerade eben";
  if (diff > 0) {
    if (diff < HOUR) return `vor ${Math.floor(diff / MINUTE)} Min.`;
    const days = calendarDaysBetween(t, now);
    if (days === 0 || diff < 6 * HOUR) return `vor ${Math.floor(diff / HOUR)} Std.`;
    if (days === 1) return "gestern";
    if (days < 7) return WEEKDAYS[new Date(t).getDay()];
  }

  // Older than a week (or in the future beyond clock skew): absolute date.
  const d = new Date(t);
  const base = `${d.getDate()}. ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === new Date(now).getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** Elapsed time: "0:42", "1:58", "1:02:03". Negative/invalid input → "0:00". */
export function formatDuration(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

/** Wall-clock time of an instant: "14:02" (24h, local time). */
export function formatClock(input: Date | number): string {
  const t = toMs(input);
  if (!Number.isFinite(t)) return "–";
  const d = new Date(t);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

const COST_FORMAT = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// No-break space: amount and currency never wrap apart in narrow meta lines.
const NBSP = "\u00A0";

/**
 * Cost in USD for display: "0,38 $", "< 0,01 $" for tiny amounts, and `null`
 * when there is nothing meaningful to show (0, negative, unknown) — callers
 * hide the cost instead of printing "$0.000". The spaces are no-break spaces.
 */
export function formatCost(usd: number | null | undefined): string | null {
  if (typeof usd !== "number" || !Number.isFinite(usd) || usd <= 0) return null;
  if (usd < 0.01) return `<${NBSP}0,01${NBSP}$`;
  return `${COST_FORMAT.format(usd)}${NBSP}$`;
}

/** Picks the singular for exactly 1, the plural otherwise (German rule). */
export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** "1 Freigabe" · "3 Freigaben". */
export function formatCount(n: number, one: string, many: string): string {
  return `${n} ${plural(n, one, many)}`;
}

/** Time-of-day greeting for the home page. */
export function greeting(date: Date = new Date()): string {
  const h = date.getHours();
  if (h < 11) return "Guten Morgen";
  if (h < 18) return "Guten Tag";
  return "Guten Abend";
}
