import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({ prisma: {} }));

import { mkdtempSync, mkdirSync, readFileSync, realpathSync, symlinkSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { UPLOAD_SUBDIR, ensureUploadDir, telegramSessionSafety } from "./telegram";
import { formatDuration, pause } from "./loop";
import { supportsApprovalGate, supportsSandbox } from "./runner";

const PROVIDERS = ["claude", "pi", "gemini", "opencode", "codex", "aider"];

describe("telegramSessionSafety", () => {
  it("keeps the configured gate for agents that enforce it", () => {
    expect(telegramSessionSafety({ provider: "claude", approvalMode: "all" })).toEqual({ provider: "claude", approvalMode: "all", sandbox: false, notice: null });
    expect(telegramSessionSafety({ provider: "pi", approvalMode: "edits" })).toMatchObject({ approvalMode: "edits", notice: null });
    // Defaults: Claude Code with file-change approval.
    expect(telegramSessionSafety({ provider: "", approvalMode: "" })).toMatchObject({ provider: "claude", approvalMode: "edits", notice: null });
  });

  it("drops a gate the agent cannot enforce and says so once", () => {
    const r = telegramSessionSafety({ provider: "gemini", approvalMode: "edits" });
    expect(r).toMatchObject({ provider: "gemini", approvalMode: "off", sandbox: false });
    expect(r.notice).toBe(
      "ℹ️ Freigabe „Nur Dateiänderungen“ gilt nicht für Gemini CLI – nur Claude Code und pi legen Änderungen und Befehle zur Freigabe vor. Diese Session läuft ohne Freigabe-Gate."
    );
    // Nothing to explain when no gate was asked for.
    expect(telegramSessionSafety({ provider: "codex", approvalMode: "off" }).notice).toBeNull();
  });

  it("never creates a session the runner refuses to run", () => {
    // runner.runTurn rejects a gate (or sandbox) the provider cannot honour.
    for (const provider of PROVIDERS) {
      for (const approvalMode of ["off", "edits", "all", ""]) {
        const r = telegramSessionSafety({ provider, approvalMode });
        expect(r.approvalMode !== "off" && !supportsApprovalGate(r.provider), `${provider}/${approvalMode}`).toBe(false);
        expect(r.sandbox && !supportsSandbox(r.provider), `${provider}/${approvalMode}`).toBe(false);
      }
    }
  });
});

describe("ensureUploadDir", () => {
  it("stores uploads inside the session's working directory, git-ignored", async () => {
    const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), "cm-tg-up-")));
    const dir = await ensureUploadDir(cwd);
    expect(dir).toBe(path.join(cwd, UPLOAD_SUBDIR));
    expect(readFileSync(path.join(dir, ".gitignore"), "utf8")).toBe("*\n");
    // Idempotent.
    await expect(ensureUploadDir(cwd)).resolves.toBe(dir);
  });

  it("refuses a folder that leads out of the project through a symlink", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "cm-tg-up-"));
    const outside = mkdtempSync(path.join(tmpdir(), "cm-tg-out-"));
    mkdirSync(path.join(outside, "uploads"));
    symlinkSync(outside, path.join(cwd, ".codemaestro"));
    await expect(ensureUploadDir(cwd)).rejects.toThrow(/Projektordner/);
  });
});

describe("helpers shared with loop.ts", () => {
  it("formats loop intervals", () => {
    expect(formatDuration(90)).toBe("90 s");
    expect(formatDuration(600)).toBe("10 min");
    expect(formatDuration(7200)).toBe("2 h");
  });

  it("pause returns at once for an already aborted signal (the poll loop's backoff)", async () => {
    const started = Date.now();
    await pause(60_000, AbortSignal.abort());
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("pause returns when the signal aborts", async () => {
    const ac = new AbortController();
    const p = pause(60_000, ac.signal);
    ac.abort();
    await expect(p).resolves.toBeUndefined();
  });
});
