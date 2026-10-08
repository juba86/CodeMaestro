// Pure composer logic (DESIGN.md §6.2.5): send modes, loop options as the loop
// route accepts them, the orchestra „Projektkontext" turned into the planner's
// preference string, and state-specific placeholders.
import { DEFAULT_LOOP_OPTIONS, type LoopOptions } from "./types";

export type ComposerMode = "chat" | "orchestrate" | "loop";

/** The pause choices between loop iterations (seconds). */
export const LOOP_INTERVALS: { sec: number; label: string }[] = [
  { sec: 0, label: "keine" },
  { sec: 60, label: "1 min" },
  { sec: 300, label: "5 min" },
  { sec: 600, label: "10 min" },
  { sec: 1800, label: "30 min" },
  { sec: 3600, label: "1 h" },
];

/** Normalizes the options to what assistantLoopSchema accepts. */
export function loopBody(o: LoopOptions): LoopOptions {
  const n = Math.floor(o.maxIterations);
  return {
    ...o,
    maxIterations: Number.isFinite(n) && n >= 1 ? Math.min(100, n) : DEFAULT_LOOP_OPTIONS.maxIterations,
    completionPromise: o.completionPromise.trim().slice(0, 100) || DEFAULT_LOOP_OPTIONS.completionPromise,
  };
}

/** „Loop · 10× · DONE". */
export function loopChipLabel(o: LoopOptions): string {
  const b = loopBody(o);
  return `Loop · ${b.maxIterations}× · ${b.completionPromise}`;
}

export type RoutingPreference = "balanced" | "quality" | "local";

export interface ProjectContext {
  stack: string;
  constraints: string;
  routing: RoutingPreference;
  verify: boolean;
}

export const EMPTY_PROJECT_CONTEXT: ProjectContext = { stack: "", constraints: "", routing: "balanced", verify: false };

/** The former wizard fields as one preference string for the planner ("" = none). */
export function buildPreference(ctx: ProjectContext): string {
  const parts: string[] = [];
  if (ctx.stack.trim()) parts.push(`Stack/Sprache: ${ctx.stack.trim()}.`);
  if (ctx.constraints.trim()) parts.push(`Rahmenbedingungen/No-Gos: ${ctx.constraints.trim()}.`);
  if (ctx.routing === "local") parts.push("Bevorzuge lokale/günstige Modelle, wo die Qualität es zulässt.");
  else if (ctx.routing === "quality") parts.push("Priorisiere beste Qualität; nutze die stärksten Modelle.");
  if (ctx.verify) parts.push("Füge eine abschließende Verifikations-/Test-Teilaufgabe hinzu.");
  return parts.join(" ").slice(0, 2000);
}

export function composerPlaceholder(opts: { mode: ComposerMode; running: boolean; offline: boolean }): string {
  if (opts.offline) return "Offline – Nachricht wird nicht gesendet";
  if (opts.running) return "Nächste Nachricht vorbereiten – senden, sobald der Lauf endet …";
  if (opts.mode === "loop") return "Aufgabe für den Loop …";
  if (opts.mode === "orchestrate") return "Aufgabe für das Orchester …";
  return "Nachricht an den Agenten …";
}

/** Why sending is not possible right now (null = can send). */
export function sendBlockedReason(opts: {
  text: string;
  running: boolean;
  offline: boolean;
  busy: boolean;
  hasSession: boolean;
}): string | null {
  if (!opts.hasSession) return "Erst eine Session wählen oder starten.";
  if (opts.offline) return "Offline – Nachricht wird nicht gesendet";
  if (opts.running) return "Der Agent arbeitet noch – senden, sobald der Lauf endet, oder den Lauf stoppen.";
  if (opts.busy) return "Plan wird erstellt …";
  if (!opts.text.trim()) return "Erst eine Nachricht eingeben.";
  return null;
}

/** Bytes for attachment chips: „812 B", „14 KB", „3,2 MB". */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toLocaleString("de-DE", { maximumFractionDigits: 1 })} MB`;
}

export const COMPOSER_DRAFT_PREFIX = "cm-composer-draft:";
export const PLAN_APPROVAL_KEY = "cm-orchestra-plan-approval";
