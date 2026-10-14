import { describe, expect, it } from "vitest";
import { clipPayload, localStamp, scheduleBlock, schedulePrompt } from "./prompt";

const at = new Date(2026, 9, 14, 9, 5).getTime();

describe("scheduleBlock", () => {
  it("names the schedule, the run number, the trigger and the time", () => {
    const b = scheduleBlock({ name: "Nightly", runNo: 3, reason: "cron", cron: "0 2 * * *", at });
    expect(b).toContain('schedule "Nightly" (run #3, cron "0 2 * * *", 2026-10-14 09:05)');
    expect(b).toContain("Do not ask questions");
    expect(b).not.toContain("<trigger_payload>");
    expect(scheduleBlock({ name: "x", runNo: 1, reason: "webhook", cron: "", at })).toContain("triggered by a webhook call");
    expect(scheduleBlock({ name: "x", runNo: 1, reason: "manual", cron: "", at })).toContain("started by hand");
  });

  it("hands a webhook payload over, clipped", () => {
    const b = scheduleBlock({ name: "x", runNo: 1, reason: "webhook", cron: "", at, payload: '{"ref":"main"}' });
    expect(b).toContain('<trigger_payload>\n{"ref":"main"}\n</trigger_payload>');
    expect(clipPayload("a".repeat(20), 5)).toBe("aaaaa\n… (gekürzt)");
    expect(clipPayload("  short ")).toBe("short");
  });

  it("puts the task after the block", () => {
    const p = schedulePrompt({ name: "x", runNo: 1, reason: "cron", cron: "0 9 * * *", at }, "  Run the tests. ");
    expect(p.endsWith("</schedule>\n\nRun the tests.")).toBe(true);
    expect(localStamp(at)).toBe("2026-10-14 09:05");
  });
});
