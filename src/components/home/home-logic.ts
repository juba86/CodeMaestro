// Pure helpers for the Start dashboard (DESIGN.md §6.1). Unit-tested.

/** One row of GET /api/assistant/sessions. */
export interface HomeSession {
  id: string;
  title: string;
  cwd: string;
  provider: string;
  model: string;
  status: string;
  totalCostUsd: number | null;
  messageCount: number;
  updatedAt: string;
}

/** One row of GET /api/prompts. */
export interface HomePrompt {
  id: string;
  title: string;
  updatedAt: string;
  _count?: { versions?: number };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Last path segment of a folder ("/home/u/code/app/" → "app"); the path itself when it has none. */
export function folderLabel(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const i = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const base = i >= 0 ? trimmed.slice(i + 1) : trimmed;
  return base || path;
}

/** The `n` most recently used project folders (sessions are newest first), without duplicates. */
export function recentFolders(sessions: Pick<HomeSession, "cwd">[], n = 3): { path: string; label: string }[] {
  const seen = new Set<string>();
  const out: { path: string; label: string }[] = [];
  for (const s of sessions) {
    const path = (s.cwd ?? "").trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    out.push({ path, label: folderLabel(path) });
    if (out.length >= n) break;
  }
  return out;
}

/** `/assistant?new=1`, optionally preset to a project folder (§6.2 handoff contract). */
export function newSessionHref(cwd?: string): string {
  return cwd ? `/assistant?new=1&cwd=${encodeURIComponent(cwd)}` : "/assistant?new=1";
}

/** Sessions updated within the last `days` days and their summed cost (unknown costs count as 0). */
export function usageSince(
  sessions: Pick<HomeSession, "updatedAt" | "totalCostUsd">[],
  now: number,
  days = 7,
): { sessions: number; costUsd: number } {
  const since = now - days * DAY_MS;
  let count = 0;
  let cost = 0;
  for (const s of sessions) {
    const t = new Date(s.updatedAt).getTime();
    if (!Number.isFinite(t) || t < since) continue;
    count++;
    if (typeof s.totalCostUsd === "number" && Number.isFinite(s.totalCostUsd) && s.totalCostUsd > 0) cost += s.totalCostUsd;
  }
  return { sessions: count, costUsd: cost };
}

/** First run: nothing to show yet — no session and no provider set up. */
export function isFirstRun(sessionCount: number, configuredProviders: number): boolean {
  return sessionCount === 0 && configuredProviders === 0;
}

/** "v3" for a prompt with three saved versions; null without versions. */
export function promptVersionLabel(p: HomePrompt): string | null {
  const n = p._count?.versions ?? 0;
  return n > 0 ? `v${n}` : null;
}
