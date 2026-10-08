/**
 * One run-state vocabulary for the whole UI (DESIGN.md §4).
 *
 * Pure TypeScript, no React: components map the result to visuals through
 * RUN_STATE_META (icon name, tone, German label) and never pick colours for
 * states themselves.
 */

export type RunState =
  | "idle"
  | "running"
  | "background"
  | "telegram"
  | "waiting_approval"
  | "waiting_answer"
  | "waiting_plan"
  | "loop_paused"
  | "stopping"
  | "stopped"
  | "done"
  | "error"
  | "unknown";

export type ConnectionOverlay = "reconnecting" | "offline" | null;

export type RunKind = "turn" | "orchestrate" | "loop";
export type RunOrigin = "pwa" | "telegram";

export interface RunStateInput {
  run?: { kind: RunKind; origin: RunOrigin; startedAt: number } | null;
  /** Open gates of the run (ApprovalEvent-like). */
  pending?: { type: string; kind?: "ask" | "plan" }[];
  loopResumeAt?: number | null;
  stopping?: boolean;
  /** This device is attached to the run's stream (the session is open here). */
  attached?: boolean;
  lastEnd?: { status: "idle" | "error" | "stopped"; at?: number; error?: string } | null;
  /** DB status from the sessions list ("running" | "idle" | "error" | …). */
  sessionStatus?: string;
  /** The client lost track (poll budget exhausted, fetch failing). */
  stale?: boolean;
  connection?: "live" | "reconnecting" | "offline";
  now?: number;
}

export type RunTone = "brand" | "warning" | "info" | "success" | "danger" | "neutral";

/** lucide-react component names used by the state vocabulary. */
export type LucideIconName =
  | "Circle"
  | "LoaderCircle"
  | "Server"
  | "Send"
  | "ShieldAlert"
  | "MessageCircleQuestion"
  | "ListChecks"
  | "Timer"
  | "Square"
  | "CircleCheck"
  | "CircleX"
  | "CircleHelp"
  | "RefreshCw"
  | "WifiOff";

export interface RunStateMeta {
  label: string;
  icon: LucideIconName;
  tone: RunTone;
  motion: "breathe" | null;
  dashed?: boolean;
  /** Render the icon filled (stopped = filled square). */
  filled?: boolean;
}

export const RUN_STATE_META: Record<RunState, RunStateMeta> = {
  idle: { label: "Bereit", icon: "Circle", tone: "neutral", motion: null },
  running: { label: "Läuft", icon: "LoaderCircle", tone: "brand", motion: "breathe" },
  background: { label: "Läuft im Hintergrund", icon: "Server", tone: "brand", motion: "breathe", dashed: true },
  telegram: { label: "Läuft · via Telegram", icon: "Send", tone: "info", motion: "breathe" },
  waiting_approval: { label: "Wartet auf Freigabe", icon: "ShieldAlert", tone: "warning", motion: null },
  waiting_answer: { label: "Wartet auf Antwort", icon: "MessageCircleQuestion", tone: "warning", motion: null },
  waiting_plan: { label: "Plan wartet auf Freigabe", icon: "ListChecks", tone: "warning", motion: null },
  loop_paused: { label: "Loop pausiert", icon: "Timer", tone: "brand", motion: null },
  stopping: { label: "Wird gestoppt …", icon: "Square", tone: "neutral", motion: null },
  stopped: { label: "Gestoppt", icon: "Square", tone: "neutral", motion: null, filled: true },
  done: { label: "Abgeschlossen", icon: "CircleCheck", tone: "success", motion: null },
  error: { label: "Fehler", icon: "CircleX", tone: "danger", motion: null },
  unknown: { label: "Status unbekannt", icon: "CircleHelp", tone: "neutral", motion: null },
};

export interface OverlayMeta {
  label: string;
  icon: LucideIconName;
  tone: RunTone;
  dashed?: boolean;
  /** Spinning icon (motion-safe only). */
  spin?: boolean;
}

export const CONNECTION_OVERLAY_META: Record<Exclude<ConnectionOverlay, null>, OverlayMeta> = {
  reconnecting: {
    label: "Verbindung wird wiederhergestellt …",
    icon: "RefreshCw",
    tone: "warning",
    dashed: true,
    spin: true,
  },
  offline: { label: "Offline – Anzeige kann veraltet sein", icon: "WifiOff", tone: "warning" },
};

/** A finished run counts as "Abgeschlossen" for this long, then as "Bereit". */
export const DONE_WINDOW_MS = 24 * 60 * 60 * 1000;

const isResolvedType = (type: string) => type.endsWith("_resolved");

function pendingState(pending: RunStateInput["pending"]): RunState | null {
  const open = (pending ?? []).filter((p) => !isResolvedType(p.type));
  if (open.length === 0) return null;
  if (open.some((p) => p.kind === "plan")) return "waiting_plan";
  if (open.some((p) => p.type === "question_request")) return "waiting_answer";
  return "waiting_approval";
}

function overlayOf(connection: RunStateInput["connection"]): ConnectionOverlay {
  if (connection === "offline") return "offline";
  if (connection === "reconnecting") return "reconnecting";
  return null;
}

/**
 * Derive the single state shown for a session (DESIGN.md §4.2, first match
 * wins). The connection is an overlay shown next to the last known state.
 */
export function deriveRunState(i: RunStateInput): { state: RunState; overlay: ConnectionOverlay } {
  const overlay = overlayOf(i.connection);
  const state = deriveState(i);
  return { state, overlay };
}

function deriveState(i: RunStateInput): RunState {
  // 1. A requested stop wins over everything until the run actually ends.
  if (i.stopping) return "stopping";

  const run = i.run ?? null;
  if (run) {
    // 2. Pending gates beat running.
    const waiting = pendingState(i.pending);
    if (waiting) return waiting;
    // 3. Loop waiting for its next iteration.
    const now = i.now ?? Date.now();
    if (run.kind === "loop" && i.loopResumeAt != null && i.loopResumeAt > now) return "loop_paused";
    // 4. Started from Telegram.
    if (run.origin === "telegram") return "telegram";
    // 5. Running here or somewhere else.
    return i.attached ? "running" : "background";
  }

  // 6. No run we can see. A client that lost track, or a DB row that still says
  // "running" without this client having seen the run end, is unknown — never
  // "Bereit". A run end observed on this client (lastEnd) counts as confirmation.
  if (i.stale) return "unknown";
  if (i.sessionStatus === "running" && !i.lastEnd) return "unknown";

  // 7. How the last run ended. Without an observed run end, an "error" row in
  // the sessions list still reads as an error (never hidden as idle).
  const lastEnd = i.lastEnd ?? (i.sessionStatus === "error" ? { status: "error" as const } : null);
  if (lastEnd?.status === "error") return "error";
  if (lastEnd?.status === "stopped") return "stopped";
  if (lastEnd?.status === "idle") {
    if (lastEnd.at == null) return "done";
    const now = i.now ?? Date.now();
    if (now - lastEnd.at < DONE_WINDOW_MS) return "done";
  }

  // 8.
  return "idle";
}

/** running / background / telegram / waiting_* / loop_paused / stopping */
export function isActive(s: RunState): boolean {
  return (
    s === "running" ||
    s === "background" ||
    s === "telegram" ||
    s === "loop_paused" ||
    s === "stopping" ||
    isWaiting(s)
  );
}

/** waiting_approval / waiting_answer / waiting_plan */
export function isWaiting(s: RunState): boolean {
  return s === "waiting_approval" || s === "waiting_answer" || s === "waiting_plan";
}

/** `blocked`: the agent ended an iteration with <promise>BLOCKED</promise> and needs the user. */
export type LoopEndReason = "promise" | "blocked" | "max" | "stopped" | "error";

const iterationWord = (n: number) => (n === 1 ? "Iteration" : "Iterationen");

/** German end note for a loop (`loop_end.reason`, DESIGN.md §4.3). */
export function loopEndText(
  reason: LoopEndReason | (string & {}),
  iterations: number,
): { text: string; tone: RunTone } {
  const n = Math.max(0, Math.floor(Number.isFinite(iterations) ? iterations : 0));
  switch (reason) {
    case "promise":
      return { text: `Ziel erreicht nach ${n} ${iterationWord(n)}`, tone: "success" };
    case "blocked":
      return {
        text: n > 0 ? `Blockiert in Iteration ${n} – braucht deine Eingabe` : "Blockiert – braucht deine Eingabe",
        tone: "warning",
      };
    case "max":
      return {
        text: `Maximum erreicht (${n} ${iterationWord(n)}) – Ziel evtl. nicht erfüllt`,
        tone: "warning",
      };
    case "stopped":
      return { text: n > 0 ? `Gestoppt nach Iteration ${n}` : "Gestoppt", tone: "neutral" };
    case "error":
      return { text: n > 0 ? `Fehler in Iteration ${n}` : "Fehler", tone: "danger" };
    default:
      return { text: `Loop beendet nach ${n} ${iterationWord(n)}`, tone: "neutral" };
  }
}
