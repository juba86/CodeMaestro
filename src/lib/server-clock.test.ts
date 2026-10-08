import { beforeEach, describe, expect, it, vi } from "vitest";
import { countdownPhase } from "@/components/ui/countdown";
import { offsetFromResponse, offsetLowerBound } from "./server-clock";

type ClockModule = typeof import("./server-clock");

const T = 1_800_000_000_000; // a client epoch ms
const MIN = 60_000;

describe("offsetFromResponse", () => {
  it("takes the midpoint of the round trip", () => {
    // Server is 3 min behind (phone 3 min fast); 200 ms round trip.
    expect(offsetFromResponse(T - 3 * MIN + 100, T, T + 200)).toBe(-3 * MIN);
    // Server ahead by 5 s.
    expect(offsetFromResponse(T + 5_050, T, T + 100)).toBe(5_000);
  });

  it("rejects unusable samples", () => {
    expect(offsetFromResponse(undefined, T, T + 100)).toBeNull();
    expect(offsetFromResponse("1800000000000", T, T + 100)).toBeNull();
    expect(offsetFromResponse(Number.NaN, T, T + 100)).toBeNull();
    expect(offsetFromResponse(0, T, T + 100)).toBeNull();
    // Client clock jumped backwards mid-request.
    expect(offsetFromResponse(T, T, T - 5)).toBeNull();
    // Device slept mid-request: the server time could be anywhere in there.
    expect(offsetFromResponse(T, T, T + 60_000)).toBeNull();
  });
});

describe("offsetLowerBound", () => {
  it("is publish time minus receive time", () => {
    expect(offsetLowerBound(T + 2_000, T)).toBe(2_000);
    expect(offsetLowerBound(T - 3 * MIN - 40, T)).toBe(-3 * MIN - 40);
    expect(offsetLowerBound(undefined, T)).toBeNull();
  });
});

describe("server clock store", () => {
  let clock: ClockModule;

  beforeEach(async () => {
    vi.resetModules(); // fresh module state per test
    clock = await import("./server-clock");
  });

  it("is the device clock until a sample arrived", () => {
    vi.spyOn(Date, "now").mockReturnValue(T);
    expect(clock.serverClockOffset()).toBe(0);
    expect(clock.serverNow()).toBe(T);
  });

  it("keeps a valid approval valid on a phone 3 minutes fast", () => {
    vi.spyOn(Date, "now").mockReturnValue(T);
    const server = T - 3 * MIN; // the server's actual time
    const expiresAt = server + 2 * MIN; // approval stamped by the server, 2 min left
    // The bug: against the raw device clock it already looks expired.
    expect(countdownPhase(expiresAt - Date.now())).toBe("expired");

    clock.noteServerTime(server, T - 50, T + 50); // stamped mid round trip
    expect(clock.serverClockOffset()).toBe(-3 * MIN);
    expect(clock.serverNow()).toBe(server);
    expect(expiresAt - clock.serverNow()).toBe(2 * MIN);
    expect(countdownPhase(expiresAt - clock.serverNow())).toBe("normal");
  });

  it("each poll replaces the estimate (device clock may be corrected meanwhile)", () => {
    clock.noteServerTime(T - 3 * MIN, T, T);
    expect(clock.serverClockOffset()).toBe(-3 * MIN);
    clock.noteServerTime(T + 10_000, T, T);
    expect(clock.serverClockOffset()).toBe(10_000);
  });

  it("ignores rejected samples", () => {
    clock.noteServerTime(T + 10_000, T, T);
    clock.noteServerTime(undefined, T, T);
    clock.noteServerTime(T - 5 * MIN, T, T + 30_000);
    expect(clock.serverClockOffset()).toBe(10_000);
  });

  it("SSE events only raise the estimate (replayed events are old)", () => {
    // A live event proves the server is at least 4 s ahead.
    clock.noteServerEvent(T + 4_000, T);
    expect(clock.serverClockOffset()).toBe(4_000);
    // A replayed event published 10 minutes ago must not drag it down.
    clock.noteServerEvent(T - 10 * MIN, T);
    expect(clock.serverClockOffset()).toBe(4_000);
    // ... nor below the response estimate of a fast phone.
    clock.noteServerTime(T - 3 * MIN, T, T);
    clock.noteServerEvent(T - 3 * MIN - 10 * MIN, T);
    expect(clock.serverClockOffset()).toBe(-3 * MIN);
    // A live event tightens a poll estimate that came out too low.
    clock.noteServerEvent(T - 3 * MIN + 900, T);
    expect(clock.serverClockOffset()).toBe(-3 * MIN + 900);
  });

  it("notifies subscribers only on changes beyond round-trip jitter", () => {
    const listener = vi.fn();
    const unsubscribe = clock.subscribeServerClock(listener);

    clock.noteServerTime(T + 100, T, T); // 100 ms: jitter
    expect(listener).not.toHaveBeenCalled();
    expect(clock.serverClockOffset()).toBe(0);

    clock.noteServerTime(T + 5_000, T, T);
    expect(listener).toHaveBeenCalledTimes(1);
    clock.noteServerTime(T + 5_120, T, T);
    clock.noteServerEvent(T + 5_200, T);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(clock.serverClockOffset()).toBe(5_000);

    unsubscribe();
    clock.noteServerTime(T - MIN, T, T);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(clock.serverClockOffset()).toBe(-MIN);
  });
});
