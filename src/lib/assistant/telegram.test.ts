import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({ prisma: {} }));

import { telegramSessionSafety } from "./telegram";
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
