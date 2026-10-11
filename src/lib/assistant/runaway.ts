// Detects a model stuck in a repetition loop: the end of its output is the
// same unit over and over (e.g. a tool-less model "calling" a tool again and
// again). Without a guard such a generation only ends when the context window
// is full — hours on a local model with a 262k context.

const MIN_UNIT = 12;
const MAX_UNIT = 400;
const REPEATS = 8;
// A unit made of few different characters is formatting (a rule of dashes, a
// table separator, blank lines), not a loop.
const MIN_DISTINCT_CHARS = 6;

/** Output length from which a check is worthwhile (shortest unit × repeats). */
export const RUNAWAY_MIN_CHARS = MIN_UNIT * REPEATS;

/**
 * The repeated unit when `text` ends in at least 8 identical consecutive
 * copies of a 12–400 character unit, otherwise null. Only the tail is
 * inspected, so the cost does not grow with the output.
 */
export function repeatedTail(text: string): string | null {
  const tail = text.slice(-MAX_UNIT * REPEATS);
  for (let unit = MIN_UNIT; unit <= MAX_UNIT && unit * REPEATS <= tail.length; unit++) {
    const last = tail.slice(-unit);
    let same = true;
    for (let i = 2; i <= REPEATS && same; i++) {
      same = tail.slice(-unit * i, -unit * (i - 1)) === last;
    }
    if (same && new Set(last.replace(/\s/g, "")).size >= MIN_DISTINCT_CHARS) return last;
  }
  return null;
}
