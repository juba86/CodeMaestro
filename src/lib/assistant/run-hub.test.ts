import { describe, expect, it } from "vitest";
import {
  SessionBusyError,
  abortRun,
  beginRun,
  endRun,
  getActiveRun,
  isSessionBusy,
  listenerCount,
  monotonicNow,
  publish,
  sseResponse,
  subscribe,
  type BufferedEvent,
} from "./run-hub";

let n = 0;
const sid = () => `test-session-${++n}`;

async function readSse(res: Response): Promise<string> {
  return await new Response(res.body).text();
}

describe("run-hub", () => {
  it("allows one active run per session and frees it after endRun", () => {
    const s = sid();
    const run = beginRun(s, "turn", "pwa");
    expect(isSessionBusy(s)).toBe(true);
    expect(() => beginRun(s, "loop", "pwa")).toThrow(SessionBusyError);
    endRun(s, run.info.runId, "idle");
    expect(isSessionBusy(s)).toBe(false);
    expect(() => beginRun(s, "loop", "pwa")).not.toThrow();
  });

  it("replays buffered events after a given seq and streams live ones", () => {
    const s = sid();
    const run = beginRun(s, "turn", "pwa");
    run.publish({ type: "text", content: "a" });
    run.publish({ type: "text", content: "b" });

    const live: BufferedEvent[] = [];
    const sub = subscribe(s, 1, (e) => live.push(e))!;
    expect(sub.replay.map((e) => e.data.type)).toEqual(["text", "text"]);
    expect(sub.replay[0].seq).toBe(2);
    expect(listenerCount(s)).toBe(1);

    run.publish({ type: "text", content: "c" });
    expect(live.map((e) => e.data.content)).toEqual(["c"]);
    sub.unsubscribe();
    expect(listenerCount(s)).toBe(0);
    endRun(s, run.info.runId, "idle");
  });

  it("ignores events from a stale run id and after the run ended", () => {
    const s = sid();
    const first = beginRun(s, "turn", "pwa");
    endRun(s, first.info.runId, "idle");
    const second = beginRun(s, "turn", "pwa");
    first.publish({ type: "text", content: "stale" });
    publish(s, { type: "text", content: "fresh" }, second.info.runId);
    const sub = subscribe(s, 0, () => {})!;
    expect(sub.replay.map((e) => e.data.content).filter(Boolean)).toEqual(["fresh"]);
    sub.unsubscribe();
    endRun(s, second.info.runId, "idle");
  });

  it("abortRun signals the run and resolves finished on end", async () => {
    const s = sid();
    const run = beginRun(s, "loop", "telegram");
    expect(abortRun(s)).toBe(true);
    expect(run.signal.aborted).toBe(true);
    endRun(s, run.info.runId, "stopped");
    await expect(run.finished).resolves.toBe("stopped");
    expect(getActiveRun(s)).toBeNull();
  });

  it("clips oversized event payloads", () => {
    const s = sid();
    const run = beginRun(s, "turn", "pwa");
    run.publish({ type: "tool_result", content: "x".repeat(50_000) });
    const sub = subscribe(s, 1, () => {})!;
    expect(String(sub.replay[0].data.content).length).toBeLessThan(17_000);
    sub.unsubscribe();
    endRun(s, run.info.runId, "idle");
  });

  it("monotonicNow is strictly increasing", () => {
    const a = monotonicNow();
    const b = monotonicNow();
    const c = monotonicNow();
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it("SSE: sends idle and closes when nothing runs", async () => {
    const text = await readSse(sseResponse(sid(), 0, new AbortController().signal));
    expect(text).toContain('"type":"idle"');
  });

  it("SSE: replays a finished run including run_end, with event ids", async () => {
    const s = sid();
    const run = beginRun(s, "turn", "pwa");
    run.publish({ type: "text", content: "hello" });
    endRun(s, run.info.runId, "idle");
    const text = await readSse(sseResponse(s, 0, new AbortController().signal));
    expect(text).toMatch(/id: 1\ndata: .*"run_start"/);
    expect(text).toContain('"content":"hello"');
    expect(text).toContain('"type":"run_end"');
  });

  it("SSE: resumes after Last-Event-ID and closes on live run_end", async () => {
    const s = sid();
    const run = beginRun(s, "turn", "pwa");
    run.publish({ type: "text", content: "one" }); // seq 2
    const res = sseResponse(s, 2, new AbortController().signal);
    run.publish({ type: "text", content: "two" });
    endRun(s, run.info.runId, "idle");
    const text = await readSse(res);
    expect(text).not.toContain('"one"');
    expect(text).toContain('"two"');
    expect(text).toContain('"run_end"');
  });

  it("SSE: client abort detaches the listener but keeps the run alive", async () => {
    const s = sid();
    const run = beginRun(s, "turn", "pwa");
    const ac = new AbortController();
    const res = sseResponse(s, 0, ac.signal);
    const reader = res.body!.getReader();
    await reader.read();
    expect(listenerCount(s)).toBe(1);
    ac.abort();
    expect(listenerCount(s)).toBe(0);
    expect(isSessionBusy(s)).toBe(true);
    endRun(s, run.info.runId, "idle");
  });
});

describe("run-hub resume across runs", () => {
  it("replays a newer run from the start when the client's position belongs to an older run", async () => {
    const s = `test-session-rerun-${Date.now()}`;
    const old = beginRun(s, "turn", "pwa");
    for (let i = 0; i < 5; i++) old.publish({ type: "text", content: `old${i}` });
    endRun(s, old.info.runId, "idle");
    const next = beginRun(s, "turn", "telegram");
    next.publish({ type: "text", content: "new" });
    endRun(s, next.info.runId, "idle");

    // Stale seq (6) from the old run, beyond the new run's lastSeq (3).
    const a = await new Response(sseResponse(s, 6, new AbortController().signal).body).text();
    expect(a).toContain('"new"');
    // Explicit run pin with a seq that exists in the new run.
    const b = await new Response(sseResponse(s, 2, new AbortController().signal, old.info.runId).body).text();
    expect(b).toContain('"run_start"');
    expect(b).toContain('"new"');
  });
});
