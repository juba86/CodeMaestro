// Live state of an orchestrator run (DESIGN.md §6.3.8), folded from the
// session's run events. Pure: shared by the /orchestra page (read-only SSE
// view) and the assistant (its own event stream). The event type is a local
// minimum on purpose — any RunEvent object can be passed in.

import { clampRounds, reviewerFor, type OrchestraConfig, type ReviewVerdict } from "@/lib/assistant/orchestra-types";
import { formatDuration } from "@/lib/format";
import { columnOf, type OrchestraColumn } from "./derive";

export type ConductorPhase =
  | "idle"
  | "planning"
  | "distributing"
  | "coordinating"
  | "synthesizing"
  /** Hybrid flow: the plan waits for the user's approval (set by the caller, no event). */
  | "awaiting_approval"
  | "done"
  | "stopped"
  | "error";

export type SubtaskStatus = "waiting" | "working" | "review" | "fixing" | "done" | "error" | "stopped";

export interface OrchestraLiveReview {
  /** Current or last review round (1-based). */
  round: number;
  /** A review round is running right now. */
  active: boolean;
  verdict: ReviewVerdict | null;
  reviewerRoleId?: string;
  reviewerRoleName?: string;
  reviewerLabel?: string;
}

export interface OrchestraLiveSubtask {
  id: string;
  title: string;
  status: SubtaskStatus;
  roleId?: string;
  roleName?: string;
  workerId?: string;
  workerLabel?: string;
  dependsOn: string[];
  editsFiles?: boolean;
  /** Local time the subtask started (receive time of subtask_start). */
  startedAt?: number;
  endedAt?: number;
  /** The fix round running after review round N. */
  fixRound?: number;
  review?: OrchestraLiveReview;
  error?: string;
}

export interface OrchestraLiveState {
  /** An orchestrator run is in progress. */
  active: boolean;
  runId: string | null;
  startedAt: number | null;
  endedAt: number | null;
  phase: ConductorPhase;
  /** In plan order. */
  subtasks: OrchestraLiveSubtask[];
  /** The orchestra roles the plan references (from the `plan` event). */
  roles: { id: string; name: string; editsFiles: boolean }[];
  currentSubtaskId: string | null;
  /** A run-level error (not tied to a subtask). */
  error: string | null;
}

export const EMPTY_ORCHESTRA_LIVE: OrchestraLiveState = Object.freeze({
  active: false,
  runId: null,
  startedAt: null,
  endedAt: null,
  phase: "idle",
  subtasks: Object.freeze([]) as unknown as OrchestraLiveSubtask[],
  roles: Object.freeze([]) as unknown as OrchestraLiveState["roles"],
  currentSubtaskId: null,
  error: null,
}) as OrchestraLiveState;

/** The event fields the reducer reads (a subset of the SSE payloads, see OrchEvent). */
export interface OrchestraLiveEvent {
  type: string;
  runId?: string;
  kind?: string;
  status?: string;
  startedAt?: number;
  content?: string;
  subtaskId?: string;
  title?: string;
  workerId?: string;
  workerLabel?: string;
  roleId?: string;
  roleName?: string;
  subtasks?: { id: string; title?: string; workerId?: string; dependsOn?: string[]; editsFiles?: boolean; roleId?: string }[];
  roles?: { id: string; name: string; editsFiles?: boolean }[];
  round?: number;
  fixRound?: number;
  reviewerRoleId?: string;
  reviewerRoleName?: string;
  reviewerLabel?: string;
  verdict?: string;
}

const IN_PROGRESS: ReadonlySet<SubtaskStatus> = new Set(["working", "review", "fixing"]);

function patchSubtask(
  state: OrchestraLiveState,
  id: string,
  patch: (st: OrchestraLiveSubtask) => OrchestraLiveSubtask,
  create?: () => OrchestraLiveSubtask
): OrchestraLiveSubtask[] {
  const index = state.subtasks.findIndex((s) => s.id === id);
  if (index < 0) return create ? [...state.subtasks, patch(create())] : state.subtasks;
  const next = patch(state.subtasks[index]);
  if (next === state.subtasks[index]) return state.subtasks;
  const out = [...state.subtasks];
  out[index] = next;
  return out;
}

const verdictOf = (v: unknown): ReviewVerdict | null => (v === "pass" || v === "changes" || v === "unknown" ? v : null);

/** Fields of subtask_start/subtask_end that identify who runs the subtask. */
function who(e: OrchestraLiveEvent): Partial<OrchestraLiveSubtask> {
  const out: Partial<OrchestraLiveSubtask> = {};
  if (e.roleId) out.roleId = e.roleId;
  if (e.roleName) out.roleName = e.roleName;
  if (e.workerId) out.workerId = e.workerId;
  if (e.workerLabel) out.workerLabel = e.workerLabel;
  return out;
}

/** Ensures the state counts as a running orchestration (events after a mid-run attach). */
function running(state: OrchestraLiveState): OrchestraLiveState {
  return state.active ? state : { ...state, active: true, endedAt: null };
}

/**
 * Folds one run event into the orchestra live state. `at` is the local
 * receive time (for „arbeitet · 0:42"). Unrelated events return `state`
 * unchanged (same reference), so callers can feed every event.
 */
export function reduceOrchestraLive(
  state: OrchestraLiveState,
  event: { type: string },
  at: number = Date.now()
): OrchestraLiveState {
  const e = event as OrchestraLiveEvent;
  switch (e.type) {
    case "run_start": {
      if (e.kind && e.kind !== "orchestrate") return state === EMPTY_ORCHESTRA_LIVE ? state : EMPTY_ORCHESTRA_LIVE;
      return {
        ...EMPTY_ORCHESTRA_LIVE,
        active: true,
        runId: e.runId ?? null,
        startedAt: typeof e.startedAt === "number" ? e.startedAt : at,
        phase: "planning",
      };
    }
    case "plan": {
      const planned = Array.isArray(e.subtasks) ? e.subtasks : [];
      const known = new Map(state.subtasks.map((s) => [s.id, s]));
      const subtasks: OrchestraLiveSubtask[] = planned
        .filter((p) => p && typeof p.id === "string")
        .map((p) => {
          const prev = known.get(p.id);
          return {
            ...prev,
            id: p.id,
            title: p.title || prev?.title || p.id,
            status: prev?.status ?? "waiting",
            roleId: p.roleId ?? prev?.roleId,
            workerId: p.workerId ?? prev?.workerId,
            dependsOn: Array.isArray(p.dependsOn) ? p.dependsOn : prev?.dependsOn ?? [],
            editsFiles: p.editsFiles ?? prev?.editsFiles,
          };
        });
      // Subtasks seen before the plan (mid-run attach) but not in it stay at the end.
      for (const s of state.subtasks) if (!planned.some((p) => p?.id === s.id)) subtasks.push(s);
      const roles = Array.isArray(e.roles)
        ? e.roles.filter((r) => r && typeof r.id === "string").map((r) => ({ id: r.id, name: r.name || r.id, editsFiles: !!r.editsFiles }))
        : state.roles;
      const busy = subtasks.some((s) => IN_PROGRESS.has(s.status));
      return { ...running(state), subtasks, roles, phase: busy ? "coordinating" : "distributing" };
    }
    case "subtask_start": {
      if (!e.subtaskId) return state;
      const subtasks = patchSubtask(
        state,
        e.subtaskId,
        (st) => ({
          ...st,
          ...who(e),
          title: e.title || st.title,
          status: "working",
          startedAt: at,
          endedAt: undefined,
          fixRound: undefined,
          error: undefined,
        }),
        () => ({ id: e.subtaskId!, title: e.title || e.subtaskId!, status: "waiting", dependsOn: [] })
      );
      return { ...running(state), subtasks, currentSubtaskId: e.subtaskId, phase: "coordinating" };
    }
    case "subtask_text": {
      if (!e.subtaskId) return state;
      const fix = typeof e.fixRound === "number" && e.fixRound > 0 ? e.fixRound : null;
      const subtasks = patchSubtask(
        state,
        e.subtaskId,
        (st) => {
          if (fix !== null) {
            if (st.status === "fixing" && st.fixRound === fix) return st;
            return { ...st, status: "fixing", fixRound: fix, review: st.review ? { ...st.review, active: false } : st.review };
          }
          if (st.status === "waiting") return { ...st, status: "working", startedAt: st.startedAt ?? at };
          return st;
        },
        () => ({ id: e.subtaskId!, title: e.subtaskId!, status: "working", dependsOn: [], startedAt: at })
      );
      if (subtasks === state.subtasks && state.active) return state;
      return { ...running(state), subtasks, currentSubtaskId: e.subtaskId };
    }
    case "subtask_end": {
      if (!e.subtaskId) return state;
      const subtasks = patchSubtask(state, e.subtaskId, (st) => ({
        ...st,
        ...who(e),
        status: st.status === "error" ? "error" : "done",
        endedAt: at,
        review: st.review ? { ...st.review, active: false } : st.review,
      }));
      return {
        ...state,
        subtasks,
        currentSubtaskId: state.currentSubtaskId === e.subtaskId ? null : state.currentSubtaskId,
      };
    }
    case "review_start": {
      if (!e.subtaskId) return state;
      const subtasks = patchSubtask(
        state,
        e.subtaskId,
        (st) => ({
          ...st,
          status: "review",
          fixRound: undefined,
          review: {
            round: typeof e.round === "number" ? e.round : (st.review?.round ?? 0) + 1,
            active: true,
            verdict: null,
            reviewerRoleId: e.reviewerRoleId ?? st.review?.reviewerRoleId,
            reviewerRoleName: e.reviewerRoleName ?? st.review?.reviewerRoleName,
            reviewerLabel: e.reviewerLabel ?? st.review?.reviewerLabel,
          },
        }),
        () => ({ id: e.subtaskId!, title: e.subtaskId!, status: "review", dependsOn: [] })
      );
      return { ...running(state), subtasks, currentSubtaskId: e.subtaskId, phase: "coordinating" };
    }
    case "review_text": {
      if (!e.subtaskId) return state;
      const subtasks = patchSubtask(state, e.subtaskId, (st) =>
        st.status === "review" && st.review?.active ? st : { ...st, status: "review", review: { round: e.round ?? st.review?.round ?? 1, verdict: null, ...st.review, active: true } }
      );
      return subtasks === state.subtasks ? state : { ...running(state), subtasks };
    }
    case "review_end": {
      if (!e.subtaskId) return state;
      const subtasks = patchSubtask(state, e.subtaskId, (st) => ({
        ...st,
        review: {
          reviewerRoleId: st.review?.reviewerRoleId,
          reviewerRoleName: st.review?.reviewerRoleName,
          reviewerLabel: st.review?.reviewerLabel,
          round: typeof e.round === "number" ? e.round : st.review?.round ?? 1,
          active: false,
          verdict: verdictOf(e.verdict) ?? "unknown",
        },
      }));
      return subtasks === state.subtasks ? state : { ...state, subtasks };
    }
    case "synthesis": {
      if (state.phase === "synthesizing" && state.active) return state;
      return { ...running(state), phase: "synthesizing", currentSubtaskId: null };
    }
    case "error": {
      const message = typeof e.content === "string" ? e.content : "Fehler";
      if (e.subtaskId) {
        const subtasks = patchSubtask(
          state,
          e.subtaskId,
          (st) => ({ ...st, status: "error", error: st.error ?? message, review: st.review ? { ...st.review, active: false } : st.review }),
          () => ({ id: e.subtaskId!, title: e.subtaskId!, status: "error", dependsOn: [] })
        );
        return { ...state, subtasks };
      }
      return { ...state, error: message, phase: "error" };
    }
    case "run_end": {
      if (!state.active && state.phase === "idle") return state;
      const status = e.status === "error" ? "error" : e.status === "stopped" ? "stopped" : "idle";
      const end: SubtaskStatus = status === "error" ? "error" : status === "stopped" ? "stopped" : "done";
      const subtasks = state.subtasks.map((st) =>
        IN_PROGRESS.has(st.status)
          ? { ...st, status: end, endedAt: at, review: st.review ? { ...st.review, active: false } : st.review }
          : st
      );
      const phase: ConductorPhase =
        status === "error" || state.phase === "error" ? "error" : status === "stopped" ? "stopped" : "done";
      return { ...state, active: false, subtasks, phase, endedAt: at, currentSubtaskId: null };
    }
    default:
      return state;
  }
}

// --- View ------------------------------------------------------------------------

export type LiveTone = "brand" | "neutral" | "success" | "warning" | "danger";

export type LiveRoleStatus =
  | "waiting"
  | "working"
  | "fixing"
  | "in_review"
  | "reviewing"
  | "passed"
  | "changes"
  | "reviewed"
  | "done"
  | "error"
  | "stopped"
  | "not_started";

export interface LiveRoleView {
  /** Role id, or `worker:<id>` for subtasks without a role. */
  key: string;
  roleId: string | null;
  name: string;
  status: LiveRoleStatus;
  /** „arbeitet · 0:42", „prüft · Runde 1/2", „fertig" … */
  label: string;
  /** Badge text for narrow cards: „arbeitet", „prüft", „Korrektur" (the rest goes to `meta`). */
  short?: string;
  /** What `short` leaves out: „0:42", „Runde 1/2", „nach Runde 1". */
  meta?: string;
  tone: LiveTone;
  /** Current subtask title, „wartet auf Coder", the error … */
  detail?: string;
  /** „1 von 2" while working, „2/2" when done. */
  progress?: string;
  /** Working right now (live card, sweep bar). */
  active: boolean;
  /** Subtask to jump to (current, else the last one). */
  subtaskId?: string;
  /** The model that actually ran it. */
  workerLabel?: string;
}

export interface LiveConductorView {
  phase: ConductorPhase;
  label: string;
  tone: LiveTone;
  active: boolean;
}

export interface LiveView {
  active: boolean;
  conductor: LiveConductorView;
  /** Per configured/planned role id. */
  roles: Record<string, LiveRoleView>;
  /** Role ids in display order (config order, then roles only the plan knows). */
  order: string[];
  /** Subtasks the Dirigent gave to a model without a role („Dirigent wählte …"). */
  unassigned: LiveRoleView[];
  /** Columns with a role working right now (for the primary connector). */
  workingColumns: OrchestraColumn[];
  /** Reviewed role ids whose review round runs right now (animated review link). */
  reviewLinks: string[];
  /** For the banner: „Coder arbeitet an Teilaufgabe 3/5". */
  summary: string;
}

const PHASE_VIEW: Record<ConductorPhase, { label: string; tone: LiveTone; active: boolean }> = {
  idle: { label: "bereit", tone: "neutral", active: false },
  planning: { label: "plant …", tone: "brand", active: true },
  distributing: { label: "verteilt Teilaufgaben", tone: "brand", active: true },
  coordinating: { label: "koordiniert", tone: "brand", active: true },
  synthesizing: { label: "fasst zusammen …", tone: "brand", active: true },
  awaiting_approval: { label: "Plan wartet auf Freigabe", tone: "warning", active: false },
  done: { label: "fertig", tone: "success", active: false },
  stopped: { label: "gestoppt", tone: "neutral", active: false },
  error: { label: "Fehler", tone: "danger", active: false },
};

/** The role a subtask belongs to: its roleId, else the first enabled role on that worker (§6.3.1). */
export function roleKeyFor(st: OrchestraLiveSubtask, config: OrchestraConfig | null | undefined): string | null {
  if (st.roleId) return st.roleId;
  if (!config || !st.workerId) return null;
  return config.roles.find((r) => r.enabled && r.workerId.trim() === st.workerId)?.id ?? null;
}

function conductorView(live: OrchestraLiveState): LiveConductorView {
  const base = PHASE_VIEW[live.phase];
  if (live.phase === "distributing") {
    const n = live.subtasks.length;
    return { phase: live.phase, ...base, label: n === 1 ? "verteilt 1 Teilaufgabe" : `verteilt ${n} Teilaufgaben` };
  }
  return { phase: live.phase, ...base };
}

const elapsed = (from: number | undefined, now: number) => (from && now > 0 ? ` · ${formatDuration(now - from)}` : "");

/**
 * Display state per role for the chart and the live list. `now` drives the
 * „arbeitet · 0:42" timer (0 = unknown → no timer).
 */
export function deriveLiveView(
  live: OrchestraLiveState,
  config: OrchestraConfig | null | undefined,
  now = 0
): LiveView {
  const nameOf = (roleId: string, st?: OrchestraLiveSubtask) =>
    config?.roles.find((r) => r.id === roleId)?.name.trim() ||
    live.roles.find((r) => r.id === roleId)?.name ||
    st?.roleName ||
    roleId;
  const maxRoundsOf = (st: OrchestraLiveSubtask): number | null => {
    const key = roleKeyFor(st, config);
    const role = key ? config?.roles.find((r) => r.id === key) : undefined;
    return role ? clampRounds(role.reviewLoop.maxRounds) : null;
  };
  const roundText = (st: OrchestraLiveSubtask) => {
    const max = maxRoundsOf(st);
    const round = st.review?.round ?? 1;
    return max ? `Runde ${round}/${Math.max(max, round)}` : `Runde ${round}`;
  };

  // Group subtasks by role (or by worker when role-less).
  const groups = new Map<string, OrchestraLiveSubtask[]>();
  const keyOrder: string[] = [];
  for (const st of live.subtasks) {
    const roleKey = roleKeyFor(st, config);
    const key = roleKey ?? `worker:${st.workerId ?? st.workerLabel ?? "?"}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      keyOrder.push(key);
    }
    groups.get(key)!.push(st);
  }
  const reviewsBy = new Map<string, OrchestraLiveSubtask[]>();
  for (const st of live.subtasks) {
    if (!st.review) continue;
    const reviewer =
      st.review.reviewerRoleId ??
      (() => {
        const key = roleKeyFor(st, config);
        return key ? config?.roles.find((r) => r.id === key)?.reviewLoop.reviewerRoleId : undefined;
      })();
    if (!reviewer) continue;
    if (!reviewsBy.has(reviewer)) reviewsBy.set(reviewer, []);
    reviewsBy.get(reviewer)!.push(st);
  }

  const ownView = (key: string, roleId: string | null, name: string, list: OrchestraLiveSubtask[]): LiveRoleView => {
    const total = list.length;
    const done = list.filter((s) => s.status === "done").length;
    const base = { key, roleId, name, workerLabel: [...list].reverse().find((s) => s.workerLabel)?.workerLabel };
    const cur = list.find((s) => IN_PROGRESS.has(s.status));
    if (cur) {
      const progress = total > 1 ? `${Math.min(done + 1, total)} von ${total}` : undefined;
      if (cur.status === "fixing") {
        return { ...base, status: "fixing", label: `Korrektur nach Runde ${cur.fixRound ?? 1}`, short: "Korrektur", meta: `nach Runde ${cur.fixRound ?? 1}`, tone: "brand", active: true, detail: cur.title, progress, subtaskId: cur.id };
      }
      if (cur.status === "review") {
        return { ...base, status: "in_review", label: `wird geprüft · ${roundText(cur)}`, short: "wird geprüft", meta: roundText(cur), tone: "brand", active: false, detail: cur.title, progress, subtaskId: cur.id };
      }
      const time = elapsed(cur.startedAt, now);
      return { ...base, status: "working", label: `arbeitet${time}`, short: "arbeitet", meta: time ? time.slice(3) : undefined, tone: "brand", active: true, detail: cur.title, progress, subtaskId: cur.id };
    }
    const last = list[list.length - 1];
    const failed = list.find((s) => s.status === "error");
    if (failed) return { ...base, status: "error", label: "Fehler", tone: "danger", active: false, detail: failed.error ?? failed.title, subtaskId: failed.id };
    if (list.some((s) => s.status === "stopped")) return { ...base, status: "stopped", label: "gestoppt", tone: "neutral", active: false, subtaskId: last?.id };
    if (total > 0 && done === total) return { ...base, status: "done", label: "fertig", tone: "success", active: false, progress: `${done}/${total}`, subtaskId: last?.id };
    if (!live.active) return { ...base, status: "not_started", label: "nicht gestartet", tone: "neutral", active: false, progress: done ? `${done}/${total}` : undefined };
    const next = list.find((s) => s.status === "waiting");
    const blocker = next?.dependsOn
      .map((id) => live.subtasks.find((s) => s.id === id))
      .find((s) => s && s.status !== "done");
    const blockerName = blocker ? (roleKeyFor(blocker, config) ? nameOf(roleKeyFor(blocker, config)!, blocker) : blocker.workerLabel) : undefined;
    return {
      ...base,
      status: "waiting",
      label: "wartet",
      tone: "neutral",
      active: false,
      detail: blockerName ? `wartet auf ${blockerName}` : next?.title,
      progress: done ? `${done}/${total}` : undefined,
      subtaskId: next?.id,
    };
  };

  const reviewerView = (roleId: string, name: string, list: OrchestraLiveSubtask[]): LiveRoleView | null => {
    const current = list.find((s) => s.review?.active);
    if (current) {
      return { key: roleId, roleId, name, status: "reviewing", label: `prüft · ${roundText(current)}`, short: "prüft", meta: roundText(current), tone: "brand", active: true, detail: current.title, subtaskId: current.id, workerLabel: current.review?.reviewerLabel };
    }
    const lastDone = [...list].reverse().find((s) => s.review?.verdict);
    if (!lastDone?.review) return null;
    const v = lastDone.review.verdict;
    const common = { key: roleId, roleId, name, active: false, detail: lastDone.title, subtaskId: lastDone.id, workerLabel: lastDone.review.reviewerLabel };
    if (v === "pass") return { ...common, status: "passed", label: "passt", tone: "success" };
    if (v === "changes") return { ...common, status: "changes", label: "Änderungen nötig", tone: "warning" };
    return { ...common, status: "reviewed", label: "geprüft", tone: "neutral" };
  };

  const roles: Record<string, LiveRoleView> = {};
  const roleIds = new Set<string>([...keyOrder.filter((k) => !k.startsWith("worker:")), ...reviewsBy.keys()]);
  for (const roleId of roleIds) {
    const own = groups.get(roleId) ?? [];
    const name = nameOf(roleId, own[0]);
    const asReviewer = reviewsBy.has(roleId) ? reviewerView(roleId, name, reviewsBy.get(roleId)!) : null;
    const asAuthor = own.length ? ownView(roleId, roleId, name, own) : null;
    let view: LiveRoleView | null;
    if (asReviewer?.active) view = asReviewer;
    else if (asAuthor && (asAuthor.active || asAuthor.status === "error" || asAuthor.status === "in_review")) view = asAuthor;
    else view = asReviewer ?? asAuthor;
    if (view) roles[roleId] = view;
  }

  // Reviewers of planned roles take part even before their first round.
  if (config && live.active) {
    const waitingFor = new Map<string, string[]>();
    for (const key of keyOrder) {
      const role = config.roles.find((r) => r.id === key);
      const reviewer = role ? reviewerFor(config, role) : null;
      if (!role || !reviewer || roles[reviewer.id]) continue;
      waitingFor.set(reviewer.id, [...(waitingFor.get(reviewer.id) ?? []), role.name.trim() || role.id]);
    }
    for (const [id, names] of waitingFor) {
      roles[id] = { key: id, roleId: id, name: nameOf(id), status: "waiting", label: "wartet", tone: "neutral", active: false, detail: `prüft danach ${names.join(", ")}` };
    }
  }

  const configOrder = (config?.roles ?? []).map((r) => r.id).filter((id) => roles[id]);
  const order = [...configOrder, ...Object.keys(roles).filter((id) => !configOrder.includes(id))];

  const unassigned = keyOrder
    .filter((k) => k.startsWith("worker:"))
    .map((k) => {
      const list = groups.get(k)!;
      const label = list.find((s) => s.workerLabel)?.workerLabel ?? list[0]?.workerId ?? "ein Modell";
      const view = ownView(k, null, label, list);
      return { ...view, detail: view.active || view.status === "error" ? view.detail : `Dirigent wählte ${label}` };
    });

  const workingColumns = new Set<OrchestraColumn>();
  const reviewLinks: string[] = [];
  if (config) {
    for (const id of order) {
      const v = roles[id];
      const role = config.roles.find((r) => r.id === id);
      if (v.active && role) workingColumns.add(columnOf(role, config));
    }
    for (const st of live.subtasks) {
      if (!st.review?.active) continue;
      const key = roleKeyFor(st, config);
      if (key) reviewLinks.push(key);
    }
  }

  return {
    active: live.active,
    conductor: conductorView(live),
    roles,
    order,
    unassigned,
    workingColumns: [...workingColumns],
    reviewLinks,
    summary: liveSummary(live, config),
  };
}

/** One line for the Live banner: „Coder arbeitet an Teilaufgabe 3/5". */
export function liveSummary(live: OrchestraLiveState, config?: OrchestraConfig | null): string {
  const total = live.subtasks.length;
  const cur = live.subtasks.find((s) => s.id === live.currentSubtaskId && IN_PROGRESS.has(s.status)) ??
    live.subtasks.find((s) => IN_PROGRESS.has(s.status));
  if (live.active && cur && live.phase !== "synthesizing") {
    const n = `${live.subtasks.indexOf(cur) + 1}/${total}`;
    const roleKey = roleKeyFor(cur, config);
    const actor =
      (roleKey && (config?.roles.find((r) => r.id === roleKey)?.name || live.roles.find((r) => r.id === roleKey)?.name || cur.roleName)) ||
      cur.workerLabel ||
      "Ein Modell";
    if (cur.status === "review") {
      if (cur.review?.active) return `${cur.review.reviewerRoleName || "Reviewer"} prüft Teilaufgabe ${n}`;
      return `Teilaufgabe ${n} wird geprüft`;
    }
    if (cur.status === "fixing") return `${actor} korrigiert Teilaufgabe ${n}`;
    return `${actor} arbeitet an Teilaufgabe ${n}`;
  }
  switch (live.phase) {
    case "planning":
      return "Dirigent plant …";
    case "distributing":
      return total === 1 ? "Dirigent verteilt 1 Teilaufgabe" : `Dirigent verteilt ${total} Teilaufgaben`;
    case "coordinating":
      return "Dirigent koordiniert";
    case "synthesizing":
      return "Dirigent fasst zusammen …";
    case "awaiting_approval":
      return "Plan wartet auf Freigabe";
    case "done":
      return "Lauf abgeschlossen";
    case "stopped":
      return "Lauf gestoppt";
    case "error":
      return "Lauf mit Fehler beendet";
    default:
      return "Orchester-Lauf";
  }
}
