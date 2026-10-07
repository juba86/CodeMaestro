import { describe, expect, it } from "vitest";
import { formatClock, formatCost, formatCount, formatDuration, formatRelative, greeting, plural } from "./format";

// Local-time constructors keep these tests independent of the machine's zone.
const NOW = new Date(2026, 9, 7, 14, 2, 30).getTime(); // Wed 7 Oct 2026, 14:02:30
const MIN = 60_000;
const HOUR = 60 * MIN;

describe("formatRelative", () => {
  it("says 'gerade eben' under a minute (and for small clock skew)", () => {
    expect(formatRelative(NOW, NOW)).toBe("gerade eben");
    expect(formatRelative(NOW - 59_000, NOW)).toBe("gerade eben");
    expect(formatRelative(NOW + 30_000, NOW)).toBe("gerade eben");
  });

  it("counts minutes under an hour", () => {
    expect(formatRelative(NOW - MIN, NOW)).toBe("vor 1 Min.");
    expect(formatRelative(NOW - 8 * MIN - 10_000, NOW)).toBe("vor 8 Min.");
    expect(formatRelative(NOW - 59 * MIN, NOW)).toBe("vor 59 Min.");
  });

  it("counts hours on the same day", () => {
    expect(formatRelative(NOW - 2 * HOUR, NOW)).toBe("vor 2 Std.");
    expect(formatRelative(new Date(2026, 9, 7, 0, 5), NOW)).toBe("vor 13 Std.");
  });

  it("keeps short cross-midnight gaps relative", () => {
    const justAfterMidnight = new Date(2026, 9, 7, 0, 30).getTime();
    expect(formatRelative(new Date(2026, 9, 6, 23, 0), justAfterMidnight)).toBe("vor 1 Std.");
  });

  it("says 'gestern' for the previous calendar day", () => {
    expect(formatRelative(new Date(2026, 9, 6, 9, 0), NOW)).toBe("gestern");
    expect(formatRelative(new Date(2026, 9, 6, 0, 1), NOW)).toBe("gestern");
  });

  it("uses the short weekday within a week", () => {
    expect(formatRelative(new Date(2026, 9, 5, 12, 0), NOW)).toBe("Mo");
    expect(formatRelative(new Date(2026, 9, 1, 12, 0), NOW)).toBe("Do");
  });

  it("uses day and month after a week, adding the year when it differs", () => {
    expect(formatRelative(new Date(2026, 8, 30, 12, 0), NOW)).toBe("30. Sept.");
    expect(formatRelative(new Date(2026, 2, 3), NOW)).toBe("3. März");
    expect(formatRelative(new Date(2025, 9, 7, 8, 0), NOW)).toBe("7. Okt. 2025");
  });

  it("accepts Date, epoch ms and ISO strings", () => {
    const t = new Date(NOW - 8 * MIN);
    expect(formatRelative(t, NOW)).toBe("vor 8 Min.");
    expect(formatRelative(t.getTime(), NOW)).toBe("vor 8 Min.");
    expect(formatRelative(t.toISOString(), NOW)).toBe("vor 8 Min.");
  });

  it("shows an absolute date for times well in the future", () => {
    expect(formatRelative(new Date(2026, 9, 9, 10, 0), NOW)).toBe("9. Okt.");
  });

  it("returns a dash for invalid input", () => {
    expect(formatRelative("kein Datum", NOW)).toBe("–");
    expect(formatRelative(Number.NaN, NOW)).toBe("–");
  });
});

describe("formatDuration", () => {
  it("formats m:ss below an hour", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(42_000)).toBe("0:42");
    expect(formatDuration(118_999)).toBe("1:58");
  });

  it("formats h:mm:ss from an hour on", () => {
    expect(formatDuration(3_723_000)).toBe("1:02:03");
    expect(formatDuration(36_000_000)).toBe("10:00:00");
  });

  it("clamps negative and invalid values", () => {
    expect(formatDuration(-5_000)).toBe("0:00");
    expect(formatDuration(Number.NaN)).toBe("0:00");
  });
});

describe("formatClock", () => {
  it("formats 24h wall-clock time", () => {
    expect(formatClock(NOW)).toBe("14:02");
    expect(formatClock(new Date(2026, 0, 1, 7, 5))).toBe("07:05");
  });
});

describe("formatCost", () => {
  it("returns null when there is nothing to show", () => {
    expect(formatCost(0)).toBeNull();
    expect(formatCost(-1)).toBeNull();
    expect(formatCost(Number.NaN)).toBeNull();
    expect(formatCost(undefined)).toBeNull();
    expect(formatCost(null)).toBeNull();
    expect(formatCost(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("collapses tiny amounts", () => {
    expect(formatCost(0.004)).toBe("<\u00A00,01\u00A0$");
    expect(formatCost(0.0099)).toBe("<\u00A00,01\u00A0$");
  });

  it("formats with a German decimal comma and two decimals", () => {
    expect(formatCost(0.01)).toBe("0,01\u00A0$");
    expect(formatCost(0.38)).toBe("0,38\u00A0$");
    expect(formatCost(0.3849)).toBe("0,38\u00A0$");
    expect(formatCost(12.5)).toBe("12,50\u00A0$");
    expect(formatCost(1234.5)).toBe("1.234,50\u00A0$");
  });
});

describe("plural / formatCount", () => {
  it("uses the singular only for exactly one", () => {
    expect(plural(1, "Freigabe", "Freigaben")).toBe("Freigabe");
    expect(plural(0, "Freigabe", "Freigaben")).toBe("Freigaben");
    expect(formatCount(1, "Freigabe", "Freigaben")).toBe("1 Freigabe");
    expect(formatCount(3, "Freigabe", "Freigaben")).toBe("3 Freigaben");
  });
});

describe("greeting", () => {
  it("switches at 11h and 18h", () => {
    expect(greeting(new Date(2026, 9, 7, 6, 0))).toBe("Guten Morgen");
    expect(greeting(new Date(2026, 9, 7, 10, 59))).toBe("Guten Morgen");
    expect(greeting(new Date(2026, 9, 7, 11, 0))).toBe("Guten Tag");
    expect(greeting(new Date(2026, 9, 7, 17, 59))).toBe("Guten Tag");
    expect(greeting(new Date(2026, 9, 7, 18, 0))).toBe("Guten Abend");
    expect(greeting(new Date(2026, 9, 7, 23, 30))).toBe("Guten Abend");
  });
});
