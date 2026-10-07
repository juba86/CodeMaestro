// Loop mode: repeats one task as a server-side run until the agent signals
// completion with <promise>TEXT</promise>, the iteration cap is reached, or the
// user stops it (Claude Code's /loop and the "Ralph" loop). The run lives in
// the run hub, so it keeps going while no browser is attached.

import type { z } from "zod";
import { prisma } from "@/lib/db/client";
import { assistantLoopSchema } from "@/lib/validation/schemas";
import { SessionBusyError, isSessionBusy, type RunHandle, type RunOrigin } from "./run-hub";
import { executeTurn, launchRun, persistUserMessage, type RunContext, type RunOutcome, type TurnOutcome } from "./session-run";

export type LoopConfig = z.infer<typeof assistantLoopSchema>;
/** What callers pass in (defaults are filled in by assistantLoopSchema). */
export type LoopInput = z.input<typeof assistantLoopSchema>;
export type LoopPromptConfig = Pick<LoopConfig, "prompt" | "maxIterations" | "completionPromise" | "freshContext">;
export type LoopEndReason = "promise" | "max" | "stopped" | "error";

/** Progress log the agent keeps when every iteration starts with a fresh context. */
export const LOOP_PROGRESS_FILE = ".codemaestro/loop-progress.md";

// Providers whose next turn resumes the previous conversation (see runner.ts:
// claude/gemini --resume, opencode --continue). codex/aider — and anything
// unknown — start from scratch every turn, so each iteration gets the full task.
const RESUMING_PROVIDERS = new Set(["claude", "gemini", "opencode"]);

// Mirrors the labels the assistant UI shows for live loop events.
const END_LABEL: Record<LoopEndReason, string> = {
  promise: "✅ Abschluss-Signal erkannt",
  max: "Max. Iterationen erreicht",
  stopped: "Gestoppt",
  error: "Abbruch nach Fehler",
};

function excerpt(text: string, max = 280): string {
  const chars = [...text.trim().replace(/\s+/g, " ")]; // code points: never split a surrogate pair
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : chars.join("");
}

/**
 * Prompt for one loop iteration. The first iteration — and every iteration
 * with a fresh context — carries the full task plus the loop protocol; a
 * `continued` conversation (one that already holds the task) only gets a
 * short reminder.
 */
export function buildIterationPrompt(
  cfg: LoopPromptConfig,
  iteration: number,
  continued = iteration > 1 && !cfg.freshContext
): string {
  const tag = `<promise>${cfg.completionPromise.trim()}</promise>`;
  const header = `Autonomous loop, iteration ${iteration} of at most ${cfg.maxIterations}.`;
  const finish = [
    "- When the whole task is complete and verified, end your final message with this line:",
    tag,
    "- Output that line only when it is true. Never use it to end the loop early, and do not write the tag anywhere else. If you are blocked, explain the blocker and what you need instead.",
  ];

  if (continued) {
    return [
      "<loop_protocol>",
      `${header} Continue the original task from where you left off:`,
      `"${excerpt(cfg.prompt)}"`,
      "- Check what is already done, then make the next concrete progress and verify it (run tests, build, type check or lint as appropriate).",
      ...finish,
      "</loop_protocol>",
    ].join("\n");
  }

  const context = cfg.freshContext
    ? `- Your conversation context is not carried over between iterations, but files are. Keep a running progress log in ${LOOP_PROGRESS_FILE} in the working directory: read it first if it exists, and before you finish update it with what you did, what is verified and what remains.`
    : "- The conversation continues across iterations; later iterations only send a short reminder.";
  return [
    "<task>",
    cfg.prompt.trim(),
    "</task>",
    "",
    "<loop_protocol>",
    `${header} The loop continues until the task is done, so work independently.`,
    "- Make concrete progress on the task in this iteration.",
    "- Verify your work before you claim it is done: run the tests, build, type check or lint as appropriate for the project.",
    context,
    ...finish,
    "</loop_protocol>",
  ].join("\n");
}

/** True when `text` contains <promise>…</promise> whose trimmed content equals `promise`. */
export function hasCompletionPromise(text: string, promise: string): boolean {
  const want = promise.trim();
  if (!want || !text) return false;
  for (const m of text.matchAll(/<promise>([\s\S]*?)<\/promise>/g)) {
    if (m[1].trim() === want) return true;
  }
  return false;
}

/** Waits `ms`, resolving early when `signal` aborts. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

function formatDuration(sec: number): string {
  if (sec % 3600 === 0) return `${sec / 3600} h`;
  if (sec % 60 === 0) return `${sec / 60} min`;
  return `${sec} s`;
}

async function runLoop(ctx: RunContext, cfg: LoopConfig, resumable: boolean): Promise<RunOutcome> {
  const { maxIterations } = cfg;
  // A CLI that cannot resume behaves like a fresh context: same prompt shape
  // (full task + progress file) no matter what the user picked.
  const fresh = cfg.freshContext || !resumable;
  const promptCfg = { ...cfg, freshContext: fresh };
  const end = (reason: LoopEndReason, iterations: number): RunOutcome => {
    ctx.publish({ type: "loop_end", reason, iterations });
    ctx.writer.flushText(); // keep the transcript in stream order
    const n = iterations === 1 ? "1 Iteration" : `${iterations} Iterationen`;
    ctx.writer.add({ role: "system", content: `${END_LABEL[reason]} · ${n}`, meta: JSON.stringify({ loopEnd: reason, iterations }) });
    return { isError: reason === "error" };
  };

  // True once the conversation the next iteration resumes holds the task.
  let carried = false;
  for (let i = 1; i <= maxIterations; i++) {
    if (ctx.signal.aborted) return end("stopped", i - 1);
    ctx.publish({ type: "loop_iteration", iteration: i, maxIterations, freshContext: fresh });
    ctx.writer.add({ role: "system", content: `🔁 Iteration ${i}/${maxIterations}` });

    const continued = !fresh && carried;
    const prompt = buildIterationPrompt(promptCfg, i, continued);
    let turn: TurnOutcome;
    try {
      turn = await executeTurn(ctx, prompt, {
        apiKey: cfg.apiKey,
        // Retrieval only helps when the prompt carries the full task.
        useKnowledge: cfg.useKnowledge && !continued,
        interactive: true,
        rowOverrides: cfg.freshContext ? { externalId: null } : undefined,
      });
    } catch (err) {
      if (ctx.signal.aborted) return end("stopped", i);
      end("error", i);
      throw err; // launchRun reports the message and marks the session as errored
    }

    if (ctx.signal.aborted) return end("stopped", i);
    // Plain CLIs may echo the prompt (which names the tag) into their output.
    if (hasCompletionPromise(turn.resultText.split(prompt).join(""), cfg.completionPromise)) {
      return end("promise", i);
    }
    if (turn.isError && cfg.stopOnError) return end("error", i);
    // A failed turn may never have reached the model (spawn error, bad resume
    // id): resend the full task rather than a reminder of something it never saw.
    carried = !turn.isError && !!turn.externalId;

    if (cfg.intervalSec > 0 && i < maxIterations) {
      const resumeAt = Date.now() + cfg.intervalSec * 1000;
      ctx.publish({ type: "loop_wait", iteration: i, resumeAt });
      ctx.writer.add({
        role: "system",
        content: `⏸ Pause ${formatDuration(cfg.intervalSec)} bis zur nächsten Iteration`,
        meta: JSON.stringify({ resumeAt }),
      });
      await pause(cfg.intervalSec * 1000, ctx.signal);
    }
  }

  return end("max", maxIterations);
}

/**
 * Starts a loop as a detached server-side run (PWA or Telegram). Throws
 * SessionBusyError when the session already runs something.
 */
export async function startLoopRun(sessionId: string, cfg: LoopInput, origin: RunOrigin): Promise<RunHandle> {
  // Re-validate (Telegram calls this directly) so the caps always hold.
  const loop = assistantLoopSchema.parse(cfg);
  const session = await prisma.assistantSession.findUnique({ where: { id: sessionId }, select: { provider: true } });
  if (!session) throw new Error("Session nicht gefunden.");
  // Check right before persisting so a busy session gets no orphaned message.
  if (isSessionBusy(sessionId)) throw new SessionBusyError();

  // Explicit allowlist: never persist the API key (or future secret fields);
  // the prompt is already the message content.
  const { maxIterations, completionPromise, intervalSec, freshContext, stopOnError, useKnowledge } = loop;
  const settings = { maxIterations, completionPromise, intervalSec, freshContext, stopOnError, useKnowledge };
  await persistUserMessage(sessionId, `🔁 Loop: ${loop.prompt}`, JSON.stringify({ loop: settings }));
  return launchRun({
    sessionId,
    kind: "loop",
    origin,
    title: `[loop] ${loop.prompt}`,
    work: (ctx) => runLoop(ctx, loop, RESUMING_PROVIDERS.has(session.provider)),
  });
}
