import { describe, expect, it } from "vitest";
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { changedFiles, snapshotWorkdir } from "./workdir-changes";

function repo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "cm-workdir-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  writeFileSync(path.join(dir, "kept.txt"), "kept\n");
  writeFileSync(path.join(dir, "dirty.txt"), "v1\n");
  writeFileSync(path.join(dir, ".gitignore"), "ignored.log\n");
  git("add", ".");
  git("commit", "-qm", "init");
  return dir;
}

describe("workdir changes", () => {
  it("is null outside a git repository", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cm-nogit-"));
    try {
      expect(await snapshotWorkdir(dir)).toBeNull();
      expect(await changedFiles(dir, null, null)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports new, re-edited, reverted and committed files, and nothing else", async () => {
    const dir = repo();
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
    try {
      // Already dirty before the subtask starts.
      writeFileSync(path.join(dir, "dirty.txt"), "v2\n");
      writeFileSync(path.join(dir, "untouched-wip.txt"), "wip\n");
      writeFileSync(path.join(dir, "reverted.txt"), "tmp\n");
      const before = await snapshotWorkdir(dir);
      expect(await changedFiles(dir, before, await snapshotWorkdir(dir))).toEqual([]);

      // The subtask: edits a dirty file again, adds one, removes one, commits one.
      writeFileSync(path.join(dir, "dirty.txt"), "v3 longer\n");
      const later = new Date(Date.now() + 5_000);
      utimesSync(path.join(dir, "dirty.txt"), later, later);
      writeFileSync(path.join(dir, "new.txt"), "new\n");
      writeFileSync(path.join(dir, "ignored.log"), "noise\n");
      rmSync(path.join(dir, "reverted.txt"));
      writeFileSync(path.join(dir, "committed.txt"), "c\n");
      git("add", "committed.txt");
      git("commit", "-qm", "add committed");

      expect(await changedFiles(dir, before, await snapshotWorkdir(dir))).toEqual([
        "committed.txt", "dirty.txt", "new.txt", "reverted.txt",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
