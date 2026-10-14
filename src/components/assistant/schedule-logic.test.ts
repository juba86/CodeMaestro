import { describe, expect, it } from "vitest";
import {
  draftFrom,
  draftProblem,
  draftToInput,
  formatUntil,
  nextRunLabel,
  rhythmChoiceFor,
  rhythmLabel,
  scheduleSummary,
  sortSchedules,
  statusTone,
  webhookUrl,
} from "./schedule-logic";

const NOW = new Date(2026, 9, 14, 9, 0).getTime(); // Wednesday
const at = (d: number, h: number, mi = 0) => new Date(2026, 9, d, h, mi).getTime();

describe("formatUntil", () => {
  it("reads like a person", () => {
    expect(formatUntil(NOW - 5000, NOW)).toBe("jetzt");
    expect(formatUntil(NOW + 3 * 60_000, NOW)).toBe("in 3 Min.");
    expect(formatUntil(at(14, 11, 30), NOW)).toBe("in 2 Std.");
    expect(formatUntil(at(14, 23, 0), NOW)).toBe("in 14 Std.");
    expect(formatUntil(at(15, 2, 0), NOW)).toBe("morgen 02:00");
    expect(formatUntil(at(16, 9, 0), NOW)).toBe("Fr 09:00");
    expect(formatUntil(at(24, 9, 0), NOW)).toBe("24. Okt. 09:00");
    expect(formatUntil("nope", NOW)).toBe("–");
  });
});

describe("labels", () => {
  it("rhythm and next run", () => {
    expect(rhythmLabel({ cron: "0 9 * * 1-5" })).toBe("Werktags um 09:00");
    expect(rhythmLabel({ cron: "" })).toBe("Nur per Webhook");
    const base = { cron: "0 9 * * *", enabled: true, nextRunAt: new Date(at(15, 9)).toISOString(), lastStatus: "" as const, onBusy: "skip" as const };
    expect(nextRunLabel(base, NOW)).toBe("Nächster Lauf morgen 09:00");
    expect(nextRunLabel({ ...base, lastStatus: "running" }, NOW)).toBe("Läuft gerade");
    expect(nextRunLabel({ ...base, enabled: false }, NOW)).toBe("Aus");
    expect(nextRunLabel({ ...base, enabled: false, lastStatus: "paused" }, NOW)).toBe("Pausiert");
    expect(nextRunLabel({ ...base, cron: "" }, NOW)).toBe("Wartet auf Webhook");
    expect(nextRunLabel({ ...base, nextRunAt: null }, NOW)).toBe("Kein nächster Termin");
    expect(nextRunLabel({ ...base, nextRunAt: new Date(NOW - 1).toISOString() }, NOW)).toBe("Startet gleich");
    expect(nextRunLabel({ ...base, nextRunAt: new Date(NOW - 1).toISOString(), onBusy: "wait" }, NOW)).toBe("Wartet auf freie Session");
    expect(statusTone("done")).toBe("success");
    expect(statusTone("paused")).toBe("danger");
    expect(statusTone("")).toBe("neutral");
    expect(webhookUrl("https://box.tail.ts.net/", "a b")).toBe("https://box.tail.ts.net/api/assistant/schedules/trigger/a%20b");
  });

  it("summary", () => {
    expect(scheduleSummary({ cron: "0 9 * * 1-5", mode: "turn", onlyIfChanged: true, notifyPush: true, notifyTelegram: true })).toBe(
      "Werktags um 09:00 · Direkt · nur bei Änderungen · Push + Telegram",
    );
    expect(scheduleSummary({ cron: "", mode: "loop", onlyIfChanged: true, notifyPush: false, notifyTelegram: false })).toBe("Nur per Webhook · Loop · ohne Benachrichtigung");
  });
});

describe("editor draft", () => {
  it("maps the rhythm select", () => {
    expect(rhythmChoiceFor("0 9 * * 1-5")).toBe("0 9 * * 1-5");
    expect(rhythmChoiceFor("5 4 * * *")).toBe("custom");
    expect(rhythmChoiceFor("  ")).toBe("none");
  });

  it("validates and normalises", () => {
    const d = draftFrom({ name: " Nightly ", prompt: " Run tests ", cron: "0 2 * * *", maxRuns: 5 });
    expect(d.maxRuns).toBe("5");
    expect(draftProblem(d)).toBeNull();
    expect(draftToInput(d)).toMatchObject({ name: "Nightly", prompt: "Run tests", maxRuns: 5, mode: "turn", loop: { maxIterations: 10 } });
    expect(draftToInput({ ...d, maxRuns: "" }).maxRuns).toBeNull();
    expect(draftProblem({ ...d, name: "" })).toBe("Erst einen Namen eingeben.");
    expect(draftProblem({ ...d, prompt: " " })).toBe("Erst die Aufgabe beschreiben.");
    expect(draftProblem({ ...d, cron: "x" })).toBe("Der Cron-Ausdruck ist ungültig.");
    expect(draftProblem({ ...d, cron: "" })).toBeNull();
    expect(draftProblem({ ...d, maxRuns: "0" })).toBe("Max. Läufe muss eine Zahl ab 1 sein.");
  });

  it("sorts enabled schedules by next run, webhook-only and disabled last", () => {
    const list = [
      { name: "off", enabled: false, nextRunAt: new Date(at(14, 10)).toISOString() },
      { name: "hook", enabled: true, nextRunAt: null },
      { name: "later", enabled: true, nextRunAt: new Date(at(15, 9)).toISOString() },
      { name: "soon", enabled: true, nextRunAt: new Date(at(14, 10)).toISOString() },
    ];
    expect(sortSchedules(list).map((s) => s.name)).toEqual(["soon", "later", "hook", "off"]);
  });
});
