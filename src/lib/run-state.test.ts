import { describe, expect, it } from "vitest";
import {
  CONNECTION_OVERLAY_META,
  DONE_WINDOW_MS,
  RUN_STATE_META,
  deriveRunState,
  isActive,
  isWaiting,
  loopEndText,
  type RunState,
  type RunStateInput,
} from "./run-state";

const NOW = 1_800_000_000_000;
const turn = { kind: "turn" as const, origin: "pwa" as const, startedAt: NOW - 5_000 };
const loop = { kind: "loop" as const, origin: "pwa" as const, startedAt: NOW - 5_000 };
const tg = { kind: "turn" as const, origin: "telegram" as const, startedAt: NOW - 5_000 };

const approval = { type: "approval_request" };
const question = { type: "question_request", kind: "ask" as const };
const plan = { type: "question_request", kind: "plan" as const };

const state = (i: RunStateInput) => deriveRunState({ now: NOW, ...i }).state;

describe("deriveRunState priority", () => {
  it("1. stopping wins over everything", () => {
    expect(state({ stopping: true, run: turn, pending: [approval], attached: true })).toBe("stopping");
    expect(state({ stopping: true })).toBe("stopping");
    expect(state({ stopping: true, stale: true, lastEnd: { status: "error" } })).toBe("stopping");
  });

  it("2. pending gates beat running (plan > question > approval)", () => {
    expect(state({ run: turn, attached: true, pending: [approval] })).toBe("waiting_approval");
    expect(state({ run: turn, attached: true, pending: [question] })).toBe("waiting_answer");
    expect(state({ run: turn, attached: true, pending: [plan] })).toBe("waiting_plan");
    expect(state({ run: turn, pending: [approval, question] })).toBe("waiting_answer");
    expect(state({ run: turn, pending: [approval, plan, question] })).toBe("waiting_plan");
  });

  it("2. pending gates also beat loop pause and telegram", () => {
    expect(state({ run: loop, loopResumeAt: NOW + 60_000, pending: [approval] })).toBe("waiting_approval");
    expect(state({ run: tg, pending: [question] })).toBe("waiting_answer");
  });

  it("2. resolved events and an empty list are not gates", () => {
    expect(state({ run: turn, attached: true, pending: [{ type: "approval_resolved" }] })).toBe("running");
    expect(state({ run: turn, attached: true, pending: [] })).toBe("running");
  });

  it("2. pending without an active run does not count as waiting", () => {
    expect(state({ pending: [approval] })).toBe("idle");
  });

  it("3. loop with a future resume time is paused", () => {
    expect(state({ run: loop, attached: true, loopResumeAt: NOW + 1 })).toBe("loop_paused");
    expect(state({ run: loop, attached: true, loopResumeAt: NOW })).toBe("running");
    expect(state({ run: loop, attached: true, loopResumeAt: NOW - 1 })).toBe("running");
    expect(state({ run: loop, attached: true, loopResumeAt: null })).toBe("running");
    // Only loops pause.
    expect(state({ run: turn, attached: true, loopResumeAt: NOW + 60_000 })).toBe("running");
  });

  it("4. telegram origin", () => {
    expect(state({ run: tg, attached: true })).toBe("telegram");
    expect(state({ run: tg, attached: false })).toBe("telegram");
    // Loop pause beats telegram.
    expect(state({ run: { ...loop, origin: "telegram" }, loopResumeAt: NOW + 5 })).toBe("loop_paused");
  });

  it("5. attached → running, otherwise background", () => {
    expect(state({ run: turn, attached: true })).toBe("running");
    expect(state({ run: turn, attached: false })).toBe("background");
    expect(state({ run: turn })).toBe("background");
    // An active run beats stale and last-end bookkeeping.
    expect(state({ run: turn, attached: true, stale: true, lastEnd: { status: "error" } })).toBe("running");
  });

  it("6. stale or an unconfirmed running row is unknown, never idle", () => {
    expect(state({ stale: true })).toBe("unknown");
    expect(state({ stale: true, lastEnd: { status: "idle", at: NOW } })).toBe("unknown");
    expect(state({ sessionStatus: "running" })).toBe("unknown");
    expect(state({ sessionStatus: "running", connection: "offline" })).toBe("unknown");
  });

  it("6. a run end seen by this client confirms a stale 'running' row", () => {
    expect(state({ sessionStatus: "running", lastEnd: { status: "idle", at: NOW - 1000 } })).toBe("done");
    expect(state({ sessionStatus: "running", lastEnd: { status: "stopped" } })).toBe("stopped");
  });

  it("7. last end: error, stopped, done", () => {
    expect(state({ lastEnd: { status: "error", error: "boom" } })).toBe("error");
    expect(state({ lastEnd: { status: "stopped", at: NOW - 1000 } })).toBe("stopped");
    expect(state({ lastEnd: { status: "idle", at: NOW - 1000 } })).toBe("done");
    expect(state({ lastEnd: { status: "idle" } })).toBe("done");
  });

  it("7. done turns into idle after 24h", () => {
    expect(state({ lastEnd: { status: "idle", at: NOW - DONE_WINDOW_MS + 1 } })).toBe("done");
    expect(state({ lastEnd: { status: "idle", at: NOW - DONE_WINDOW_MS } })).toBe("idle");
    expect(state({ lastEnd: { status: "idle", at: NOW - 3 * DONE_WINDOW_MS } })).toBe("idle");
    // Errors and stops do not age out.
    expect(state({ lastEnd: { status: "error", at: NOW - 3 * DONE_WINDOW_MS } })).toBe("error");
    expect(state({ lastEnd: { status: "stopped", at: NOW - 3 * DONE_WINDOW_MS } })).toBe("stopped");
  });

  it("7. an error row from the sessions list stays an error", () => {
    expect(state({ sessionStatus: "error" })).toBe("error");
    expect(state({ sessionStatus: "error", lastEnd: { status: "idle", at: NOW } })).toBe("done");
  });

  it("8. otherwise idle", () => {
    expect(state({})).toBe("idle");
    expect(state({ sessionStatus: "idle" })).toBe("idle");
    expect(state({ run: null, pending: [] })).toBe("idle");
  });

  it("uses Date.now() when no clock is given", () => {
    const r = deriveRunState({ run: loop, attached: true, loopResumeAt: Date.now() + 60_000 });
    expect(r.state).toBe("loop_paused");
  });
});

describe("connection overlay", () => {
  it("maps the connection to an overlay next to the state", () => {
    expect(deriveRunState({ now: NOW, run: turn, attached: true, connection: "reconnecting" })).toEqual({
      state: "running",
      overlay: "reconnecting",
    });
    expect(deriveRunState({ now: NOW, lastEnd: { status: "error" }, connection: "offline" })).toEqual({
      state: "error",
      overlay: "offline",
    });
    expect(deriveRunState({ now: NOW, connection: "live" }).overlay).toBeNull();
    expect(deriveRunState({ now: NOW }).overlay).toBeNull();
  });

  it("the overlay never replaces the state", () => {
    const r = deriveRunState({ now: NOW, run: turn, pending: [approval], connection: "offline" });
    expect(r.state).toBe("waiting_approval");
    expect(r.overlay).toBe("offline");
  });

  it("has German overlay labels", () => {
    expect(CONNECTION_OVERLAY_META.reconnecting.label).toBe("Verbindung wird wiederhergestellt …");
    expect(CONNECTION_OVERLAY_META.reconnecting.dashed).toBe(true);
    expect(CONNECTION_OVERLAY_META.offline.label).toBe("Offline – Anzeige kann veraltet sein");
  });
});

describe("unknown is never idle", () => {
  it("holds for every combination of lastEnd and connection when stale", () => {
    const ends: RunStateInput["lastEnd"][] = [
      null,
      { status: "idle" },
      { status: "idle", at: NOW - 3 * DONE_WINDOW_MS },
      { status: "error" },
      { status: "stopped" },
    ];
    for (const lastEnd of ends) {
      for (const connection of ["live", "reconnecting", "offline"] as const) {
        expect(state({ stale: true, lastEnd, connection })).toBe("unknown");
      }
    }
  });
});

describe("meta, isActive, isWaiting", () => {
  const all = Object.keys(RUN_STATE_META) as RunState[];

  it("has a German label, icon and tone for every state", () => {
    expect(all).toHaveLength(13);
    for (const s of all) {
      expect(RUN_STATE_META[s].label.length).toBeGreaterThan(0);
      expect(RUN_STATE_META[s].icon.length).toBeGreaterThan(0);
    }
    expect(RUN_STATE_META.idle.label).toBe("Bereit");
    expect(RUN_STATE_META.unknown.label).toBe("Status unbekannt");
    expect(RUN_STATE_META.background.dashed).toBe(true);
    expect(RUN_STATE_META.running.motion).toBe("breathe");
    expect(RUN_STATE_META.waiting_approval.tone).toBe("warning");
    expect(RUN_STATE_META.telegram.tone).toBe("info");
    expect(RUN_STATE_META.done.tone).toBe("success");
    expect(RUN_STATE_META.error.tone).toBe("danger");
    expect(RUN_STATE_META.stopped.filled).toBe(true);
  });

  it("isActive / isWaiting", () => {
    const active = all.filter(isActive).sort();
    expect(active).toEqual(
      [
        "background",
        "loop_paused",
        "running",
        "stopping",
        "telegram",
        "waiting_answer",
        "waiting_approval",
        "waiting_plan",
      ].sort(),
    );
    expect(all.filter(isWaiting).sort()).toEqual(["waiting_answer", "waiting_approval", "waiting_plan"]);
    for (const s of ["idle", "done", "error", "stopped", "unknown"] as const) expect(isActive(s)).toBe(false);
  });
});

describe("loopEndText", () => {
  it("covers every reason with its tone", () => {
    expect(loopEndText("promise", 6)).toEqual({ text: "Ziel erreicht nach 6 Iterationen", tone: "success" });
    expect(loopEndText("promise", 1)).toEqual({ text: "Ziel erreicht nach 1 Iteration", tone: "success" });
    expect(loopEndText("max", 10)).toEqual({
      text: "Maximum erreicht (10 Iterationen) – Ziel evtl. nicht erfüllt",
      tone: "warning",
    });
    expect(loopEndText("stopped", 3)).toEqual({ text: "Gestoppt nach Iteration 3", tone: "neutral" });
    expect(loopEndText("error", 4)).toEqual({ text: "Fehler in Iteration 4", tone: "danger" });
    // Server-side reason for <promise>BLOCKED</promise> (loop.ts), not in the §4.3 table.
    expect(loopEndText("blocked", 2)).toEqual({ text: "Blockiert in Iteration 2 – braucht deine Eingabe", tone: "warning" });
    expect(loopEndText("blocked", 0).text).toBe("Blockiert – braucht deine Eingabe");
  });

  it("handles zero and unknown reasons", () => {
    expect(loopEndText("stopped", 0).text).toBe("Gestoppt");
    expect(loopEndText("error", 0).text).toBe("Fehler");
    expect(loopEndText("weird", 2)).toEqual({ text: "Loop beendet nach 2 Iterationen", tone: "neutral" });
    expect(loopEndText("promise", Number.NaN).text).toBe("Ziel erreicht nach 0 Iterationen");
  });
});
