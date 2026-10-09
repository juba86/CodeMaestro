// What one orchestra agent passes on to the next (see orchestrator.executePlan).
//
// Every agent starts with an empty context and only its own instruction, so
// what it learns about the work before it decides whether it builds on that
// work or explores the project all over again — expensive for local models
// with a small context window. A handoff therefore carries, per earlier
// subtask: who did it, which files it actually touched (measured, not
// claimed) and the agent's own closing "Handoff" section. Subtasks the next
// one depends on get most of the budget; the others a short note. The budget
// follows the receiving model's context window.
//
// Pure (no I/O), so it can be unit tested; the file measurement lives in
// workdir-changes.ts.

/** Heading the agents are asked to end their reply with. */
export const HANDOFF_HEADING = "## Handoff";

/**
 * Closing instruction of a subtask prompt. Asks for facts the next agent can
 * act on without re-reading the project.
 */
export const HANDOFF_INSTRUCTION =
  `Another agent continues after you and sees only the end of your reply, not your work. ` +
  `So finish with a section headed exactly "${HANDOFF_HEADING}" that states, in short bullet points: ` +
  `what you did or decided; the files you changed or that matter for what comes next (paths); ` +
  `facts the next agent would otherwise have to find out again (commands that work, test results, pitfalls); ` +
  `and what is still open. Keep it under 250 words and write only what is true of the current state.`;

const HEADING = /^#{1,6}\s*(handoff|übergabe|uebergabe)\b[^\n]*$/gim;

/** The agent's closing handoff section (text after the last such heading), if it wrote one. */
export function extractHandoff(text: string): string | null {
  let last: RegExpExecArray | null = null;
  HEADING.lastIndex = 0;
  for (let m = HEADING.exec(text); m; m = HEADING.exec(text)) last = m;
  if (!last) return null;
  const section = text.slice(last.index + last[0].length).trim();
  return section || null;
}

/** Keeps the start and the end of a long text (reports end with the summary). */
export function clipMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max / 4);
  return `${text.slice(0, head)}\n[…]\n${text.slice(text.length - (max - head))}`;
}

/**
 * What to pass on from one agent's output: its handoff section when it wrote
 * one, otherwise the output itself — clipped to `max` characters either way.
 */
export function handoffNote(output: string, max: number): string {
  const text = output.trim();
  if (!text) return "";
  return clipMiddle(extractHandoff(text) ?? text, max);
}

const MIN_BUDGET_CHARS = 4_000;
const MAX_BUDGET_CHARS = 24_000;
// Share of the receiving model's context spent on handoffs (≈4 chars/token).
const CONTEXT_SHARE = 0.12;

/**
 * Characters of handoff text a worker gets. Follows its context window when
 * known (local models), so a 32k agent is not flooded and a 256k one is not
 * starved; cloud agents get the maximum.
 */
export function handoffBudget(contextWindow?: number): number {
  if (!contextWindow || contextWindow <= 0) return MAX_BUDGET_CHARS;
  return Math.round(Math.min(MAX_BUDGET_CHARS, Math.max(MIN_BUDGET_CHARS, contextWindow * 4 * CONTEXT_SHARE)));
}

export interface HandoffEntry {
  id: string;
  title: string;
  /** Who did it, e.g. "Architekt, pi · qwen3.8:27b-64k". */
  by: string;
  /** The agent's full output (including fix rounds). */
  output: string;
  /** Files the subtask actually changed, relative to the working directory. */
  files?: string[];
  /** The subtask reported an error or was cut short. */
  failed?: boolean;
  /** Outcome of the automatic review, e.g. "pass after 2 round(s)". */
  review?: string;
}

// A subtask the next one does not depend on: enough to know what exists.
const BRIEF_CHARS = 700;
const MIN_DEPENDENCY_CHARS = 1_500;
const MAX_FILES = 40;

const attr = (s: string) => s.replace(/["<>\n]/g, " ").trim();

function fileLine(files: string[] | undefined): string {
  if (!files?.length) return "";
  const shown = files.slice(0, MAX_FILES).join(", ");
  return `Files changed: ${shown}${files.length > MAX_FILES ? `, … (+${files.length - MAX_FILES} more)` : ""}\n`;
}

/**
 * The "previous work" block of a subtask prompt: every earlier subtask in the
 * order it ran. `dependsOn` names the ones the next subtask builds on — they
 * share the budget that the short notes of the others leave over. Returns ""
 * when nothing ran before.
 */
export function buildHandoffContext(entries: HandoffEntry[], dependsOn: string[], budget: number): string {
  if (!entries.length) return "";
  const deps = new Set(dependsOn);
  const direct = entries.filter((e) => deps.has(e.id));
  const others = entries.length - direct.length;
  // With many earlier subtasks the short notes shrink before the dependencies do.
  const brief = Math.max(200, Math.min(BRIEF_CHARS, Math.floor((budget * 0.4) / Math.max(1, others))));
  const perDirect = direct.length
    ? Math.max(MIN_DEPENDENCY_CHARS, Math.floor((budget - others * brief) / direct.length))
    : 0;

  const blocks = entries.map((e) => {
    const isDep = deps.has(e.id);
    const note = handoffNote(e.output, isDep ? perDirect : brief) || "(no text output)";
    const status = [
      isDep ? "you build on this" : "",
      e.failed ? "ended with an error — check its result before relying on it" : "",
      e.review ? `review: ${e.review}` : "",
    ].filter(Boolean).join("; ");
    return `<subtask id="${attr(e.id)}" title="${attr(e.title)}" by="${attr(e.by)}"${status ? ` status="${attr(status)}"` : ""}>\n${fileLine(e.files)}${note}\n</subtask>`;
  });

  return (
    `<previous_work>\n` +
    `These subtasks already ran, in this order, in the same working directory. Their file changes are on disk. ` +
    `Build on them: open the files named here directly instead of exploring the project again, and do not redo finished work.\n\n` +
    `${blocks.join("\n\n")}\n</previous_work>`
  );
}
