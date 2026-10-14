// The timer behind session schedules: every half minute it starts whatever is
// due (schedules.tickSchedules). State sits on globalThis — the instrumentation
// hook and route handlers live in separate module graphs — so one process has
// exactly one timer, also across dev reloads.

import { reconcileSchedules, tickSchedules } from "./schedules";

const TICK_MS = 30_000;

interface SchedulerState {
  timer: ReturnType<typeof setInterval> | null;
  ticking: boolean;
}

const g = globalThis as unknown as { __cmScheduler?: SchedulerState };
function state(): SchedulerState {
  if (!g.__cmScheduler) g.__cmScheduler = { timer: null, ticking: false };
  return g.__cmScheduler;
}

/** One tick; overlapping ticks (a slow database) collapse into one. */
export async function runSchedulerTick(now: number = Date.now()): Promise<void> {
  const s = state();
  if (s.ticking) return;
  s.ticking = true;
  try {
    await tickSchedules(now);
  } catch (err) {
    console.error("[scheduler] tick failed", err);
  } finally {
    s.ticking = false;
  }
}

/** Starts the timer (idempotent). The first tick follows the boot reconciliation. */
export function startScheduler(): void {
  const s = state();
  if (s.timer) return;
  s.timer = setInterval(() => void runSchedulerTick(), TICK_MS);
  // Do not keep the process alive just for the timer.
  (s.timer as { unref?: () => void }).unref?.();
  void reconcileSchedules()
    .catch((err) => console.error("[scheduler] reconcile failed", err))
    .then(() => runSchedulerTick());
}

export function stopScheduler(): void {
  const s = state();
  if (s.timer) clearInterval(s.timer);
  s.timer = null;
}

export function schedulerRunning(): boolean {
  return state().timer !== null;
}
