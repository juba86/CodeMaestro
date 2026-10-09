// Measures which files a subtask changed in a git working directory, so the
// next agent is told facts instead of the previous agent's recollection (see
// handoff.ts). Best effort: outside a git repository, or when git is slow or
// missing, there is simply no file list.

import { execFile } from "child_process";
import { stat } from "fs/promises";
import path from "path";

const GIT_TIMEOUT_MS = 5_000;
// Beyond this many dirty files a per-file comparison is not worth its cost.
const MAX_TRACKED = 2_000;

export interface WorkdirSnapshot {
  head: string;
  /** Dirty and untracked files → a change marker (mtime:size, or "gone"). */
  dirty: Map<string, string>;
}

function git(cwd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? null : stdout);
    });
  });
}

const lines = (out: string | null) => (out ? out.split("\0").filter(Boolean) : []);

/** The working directory's state, or null when it is not a usable git repository. */
export async function snapshotWorkdir(cwd: string): Promise<WorkdirSnapshot | null> {
  const head = await git(cwd, ["rev-parse", "HEAD"]);
  if (head === null) return null;
  // Modified, deleted and untracked (not ignored) files, relative to cwd.
  const files = lines(await git(cwd, ["ls-files", "-z", "--modified", "--deleted", "--others", "--exclude-standard"]));
  if (files.length > MAX_TRACKED) return { head: head.trim(), dirty: new Map() };
  const dirty = new Map<string, string>();
  await Promise.all(
    [...new Set(files)].map(async (f) => {
      try {
        const s = await stat(path.join(cwd, f));
        dirty.set(f, `${s.mtimeMs}:${s.size}`);
      } catch {
        dirty.set(f, "gone");
      }
    })
  );
  return { head: head.trim(), dirty };
}

/**
 * Files that changed between two snapshots: newly dirty or modified again,
 * cleaned up (reverted), and everything touched by commits made in between.
 * Sorted; [] when nothing changed or a snapshot is missing.
 */
export async function changedFiles(cwd: string, before: WorkdirSnapshot | null, after: WorkdirSnapshot | null): Promise<string[]> {
  if (!before || !after) return [];
  const changed = new Set<string>();
  for (const [f, mark] of after.dirty) if (before.dirty.get(f) !== mark) changed.add(f);
  for (const f of before.dirty.keys()) if (!after.dirty.has(f)) changed.add(f);
  if (before.head !== after.head) {
    for (const f of lines(await git(cwd, ["diff", "-z", "--name-only", "--relative", before.head, after.head]))) changed.add(f);
  }
  return [...changed].sort();
}
