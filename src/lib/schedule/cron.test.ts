import { describe, expect, it } from "vitest";
import { CRON_PRESETS, describeCron, isValidCron, nextCronRun, nextCronRuns, parseCron } from "./cron";

// Local-time construction keeps the tests independent of the machine's zone.
const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0);

describe("parseCron", () => {
  it("expands stars, lists, ranges and steps", () => {
    const s = parseCron("*/15 9-17 1,15 * 1-5");
    expect([...s.minutes]).toEqual([0, 15, 30, 45]);
    expect([...s.hours]).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect([...s.days]).toEqual([1, 15]);
    expect(s.months.size).toBe(12);
    expect([...s.weekdays]).toEqual([1, 2, 3, 4, 5]);
    expect(s.dayRestricted).toBe(true);
    expect(s.weekdayRestricted).toBe(true);
  });

  it("accepts names and maps Sunday 7 onto 0", () => {
    const s = parseCron("0 8 * jan,dec sun");
    expect([...s.months]).toEqual([1, 12]);
    expect([...s.weekdays]).toEqual([0]);
    expect([...parseCron("0 8 * * 7").weekdays]).toEqual([0]);
    expect([...parseCron("0 8 * * mon-fri").weekdays]).toEqual([1, 2, 3, 4, 5]);
  });

  it("rejects malformed expressions with a German message", () => {
    expect(() => parseCron("0 8 * *")).toThrow(/fünf Felder/);
    expect(() => parseCron("60 * * * *")).toThrow(/außerhalb/);
    expect(() => parseCron("*/0 * * * *")).toThrow(/Schrittweite/);
    expect(() => parseCron("5-1 * * * *")).toThrow(/verkehrt/);
    expect(() => parseCron("a * * * *")).toThrow(/Ungültiger Wert/);
    expect(isValidCron("0 9 * * 1-5")).toBe(true);
    expect(isValidCron("")).toBe(false);
    expect(isValidCron("* * * * * *")).toBe(false);
  });
});

describe("nextCronRun", () => {
  it("finds the next minute strictly after `from`, dropping seconds", () => {
    const from = new Date(2026, 9, 14, 9, 0, 30);
    expect(nextCronRun("0 9 * * *", from)).toEqual(at(2026, 10, 15, 9, 0));
    expect(nextCronRun("*/15 * * * *", from)).toEqual(at(2026, 10, 14, 9, 15));
    expect(nextCronRun("* * * * *", from)).toEqual(at(2026, 10, 14, 9, 1));
  });

  it("skips to the right weekday, month day and month", () => {
    // 2026-10-17 is a Saturday.
    expect(nextCronRun("30 18 * * 1-5", at(2026, 10, 17, 12))).toEqual(at(2026, 10, 19, 18, 30));
    expect(nextCronRun("0 8 1 * *", at(2026, 10, 17))).toEqual(at(2026, 11, 1, 8, 0));
    expect(nextCronRun("0 0 1 jan *", at(2026, 10, 17))).toEqual(at(2027, 1, 1, 0, 0));
  });

  it("treats day-of-month and day-of-week as alternatives when both are set", () => {
    // Friday the 16th or any Monday: from Thursday 15th the next is Friday 16th.
    expect(nextCronRun("0 9 16 * 1", at(2026, 10, 15, 10))).toEqual(at(2026, 10, 16, 9, 0));
    expect(nextCronRun("0 9 16 * 1", at(2026, 10, 16, 10))).toEqual(at(2026, 10, 19, 9, 0));
  });

  it("gives up on expressions that never match", () => {
    expect(nextCronRun("0 0 31 feb *", at(2026, 10, 17))).toBeNull();
  });

  it("lists consecutive runs", () => {
    expect(nextCronRuns("0 9 * * *", 3, at(2026, 10, 14, 10))).toEqual([at(2026, 10, 15, 9), at(2026, 10, 16, 9), at(2026, 10, 17, 9)]);
  });
});

describe("describeCron", () => {
  it("describes common rhythms in German", () => {
    expect(describeCron("*/15 * * * *")).toBe("Alle 15 Minuten");
    expect(describeCron("* * * * *")).toBe("Jede Minute");
    expect(describeCron("0 * * * *")).toBe("Stündlich");
    expect(describeCron("30 * * * *")).toBe("Stündlich (Minute 30)");
    expect(describeCron("0 */4 * * *")).toBe("Alle 4 Stunden");
    expect(describeCron("0 9 * * *")).toBe("Täglich um 09:00");
    expect(describeCron("30 18 * * 1-5")).toBe("Werktags um 18:30");
    expect(describeCron("0 10 * * 0,6")).toBe("Am Wochenende um 10:00");
    expect(describeCron("0 9 * * 1")).toBe("Jeden Montag um 09:00");
    expect(describeCron("0 9 * * 1,3,0")).toBe("Mo, Mi, So um 09:00");
    expect(describeCron("0 8 1 * *")).toBe("Am 1. jedes Monats um 08:00");
    expect(describeCron("0 8 1,15 * *")).toBe("Am 1., 15. jedes Monats um 08:00");
  });

  it("falls back to the raw expression and to an empty string", () => {
    expect(describeCron("0,30 9 * jan *")).toBe("Cron: 0,30 9 * jan *");
    expect(describeCron("nope")).toBe("");
  });

  it("every preset parses and has a short description", () => {
    for (const p of CRON_PRESETS) {
      expect(isValidCron(p.cron), p.cron).toBe(true);
      expect(describeCron(p.cron)).not.toMatch(/^Cron:/);
    }
  });
});
