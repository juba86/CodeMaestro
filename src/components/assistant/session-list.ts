// Pure session-list logic (DESIGN.md §6.2.1): filter (Alle · Aktiv · Wartet),
// search by title/folder, and grouping into Aktiv · Heute · Diese Woche · Älter.
import type { SessionSummary } from "./types";

export type SessionFilter = "all" | "active" | "waiting";

export interface SessionGroup {
  id: "active" | "today" | "week" | "older";
  label: string;
  sessions: SessionSummary[];
}

const GROUP_LABEL: Record<SessionGroup["id"], string> = {
  active: "Aktiv",
  today: "Heute",
  week: "Diese Woche",
  older: "Älter",
};

/** Last path segment of a working directory („CodeMaestro"). */
export function folderName(cwd: string): string {
  const parts = cwd.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || cwd || "/";
}

/** `/home/jurak/x` → `~/x` (display only). */
export function shortPath(cwd: string): string {
  return cwd.replace(/^\/(home|Users)\/[^/]+(?=\/|$)/, "~");
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Monday 00:00 of the week containing `ms` (German weeks start on Monday). */
function startOfWeek(ms: number): number {
  const d = new Date(startOfDay(ms));
  const back = (d.getDay() + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back).getTime();
}

export interface ListActivity {
  /** Sessions with an active run. */
  active: ReadonlySet<string>;
  /** Sessions with an open approval/question. */
  waiting: ReadonlySet<string>;
}

export function filterSessions(
  sessions: SessionSummary[],
  filter: SessionFilter,
  query: string,
  activity: ListActivity,
): SessionSummary[] {
  const q = query.trim().toLowerCase();
  return sessions.filter((s) => {
    if (filter === "active" && !(activity.active.has(s.id) || activity.waiting.has(s.id) || s.status === "running")) return false;
    if (filter === "waiting" && !activity.waiting.has(s.id)) return false;
    if (!q) return true;
    return s.title.toLowerCase().includes(q) || s.cwd.toLowerCase().includes(q);
  });
}

/** Groups in display order; empty groups are left out. Within a group, newest first. */
export function groupSessions(sessions: SessionSummary[], activity: ListActivity, now: number = Date.now()): SessionGroup[] {
  const today = startOfDay(now);
  const week = startOfWeek(now);
  const buckets: Record<SessionGroup["id"], SessionSummary[]> = { active: [], today: [], week: [], older: [] };
  const sorted = [...sessions].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  for (const s of sorted) {
    const t = Date.parse(s.updatedAt);
    if (activity.active.has(s.id) || activity.waiting.has(s.id) || s.status === "running") buckets.active.push(s);
    else if (Number.isFinite(t) && t >= today) buckets.today.push(s);
    else if (Number.isFinite(t) && t >= week) buckets.week.push(s);
    else buckets.older.push(s);
  }
  return (Object.keys(buckets) as SessionGroup["id"][])
    .filter((id) => buckets[id].length > 0)
    .map((id) => ({ id, label: GROUP_LABEL[id], sessions: buckets[id] }));
}

/** The session after/before `current` in display order (wraps around), for J/K. */
export function neighbourSession(order: string[], current: string | null, step: 1 | -1): string | null {
  if (order.length === 0) return null;
  const i = current ? order.indexOf(current) : -1;
  if (i < 0) return step === 1 ? order[0] : order[order.length - 1];
  return order[(i + step + order.length) % order.length];
}

/** Recently used project folders (newest first, unique). */
export function recentFolders(sessions: SessionSummary[], max = 5): string[] {
  const out: string[] = [];
  const sorted = [...sessions].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  for (const s of sorted) {
    if (s.cwd && !out.includes(s.cwd)) out.push(s.cwd);
    if (out.length >= max) break;
  }
  return out;
}
