// Pure thread model (DESIGN.md §6.2.4): turns transcript rows (persisted and
// live, same shapes) into display blocks — user prompts, Markdown answers,
// folded tool groups, iteration dividers, orchestrator plans with one section
// per subtask (work, review rounds, fix rounds, errors) and the synthesis.
import { metaOf, rowTime, type RowMeta } from "./meta";
import { isToolRow, pairToolCalls, toolGroup, type ToolCall, type ToolGroupModel } from "./tool-calls";
import type { LoopEndReason, Msg, PlannedSubtask, ReviewVerdict } from "./types";

export interface ThreadRow {
  msg: Msg;
  key: string;
  /** Row of the run that is still going (tool calls without result are running). */
  live: boolean;
  /** Index into the live rows (undefined for persisted rows). */
  liveIndex?: number;
}

export type SubtaskPart =
  | { kind: "work"; key: string; text: string; at?: number }
  | {
      kind: "review";
      key: string;
      round: number;
      maxRounds?: number;
      verdict: ReviewVerdict | null;
      text: string;
      reviewerName?: string;
      reviewerLabel?: string;
      at?: number;
    }
  | { kind: "fix"; key: string; round: number; text: string; at?: number }
  | { kind: "error"; key: string; text: string; round?: number; review?: boolean };

export interface SubtaskSectionModel {
  /** Unique per orchestration (subtask ids repeat across runs). */
  key: string;
  subtaskId: string;
  title: string;
  roleId?: string;
  roleName?: string;
  workerLabel?: string;
  parts: SubtaskPart[];
  hasError: boolean;
  /** Rows come from the running orchestration. */
  live: boolean;
  /** The plan's position (1-based) when known. */
  index?: number;
}

export interface PlanRole {
  id: string;
  name: string;
  editsFiles?: boolean;
}

export type ThreadBlock =
  | { kind: "user"; key: string; text: string; loop: boolean; local: boolean; at?: number }
  | { kind: "assistant"; key: string; text: string; segmentStart: boolean; live: boolean; at?: number }
  | { kind: "thinking"; key: string; text: string; segmentStart: boolean }
  | { kind: "tools"; key: string; group: ToolGroupModel; segmentStart: boolean }
  | { kind: "knowledge"; key: string; sources: string[]; segmentStart: boolean }
  | { kind: "iteration"; key: string; iteration: number; max: number; fresh?: boolean; at?: number }
  | { kind: "loop_wait"; key: string; resumeAt?: number; text: string }
  | { kind: "loop_end"; key: string; reason: LoopEndReason | string; iterations: number }
  | { kind: "system"; key: string; text: string }
  | { kind: "error"; key: string; text: string }
  | {
      kind: "plan";
      key: string;
      task: string;
      subtasks: PlannedSubtask[];
      roles: PlanRole[];
      workers: { id: string; label: string }[];
      live: boolean;
    }
  | { kind: "subtask"; key: string; section: SubtaskSectionModel }
  | { kind: "synthesis"; key: string; text: string; live: boolean }
  | { kind: "gate"; key: string; approvalId: string };

/** A gate (pending card or receipt) placed after live row `pos - 1`. */
export interface GatePlacement {
  approvalId: string;
  /** Index into the live rows; undefined = after everything. */
  pos?: number;
}

const ITERATION_RE = /^🔁\s*Iteration\s+(\d+)\s*\/\s*(\d+)/;
const LOOP_PROMPT_RE = /^🔁\s*Loop:\s*/;

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function verdictOf(v: unknown): ReviewVerdict | null {
  return v === "pass" || v === "changes" || v === "unknown" ? v : null;
}

/** Rows of the thread in order: persisted first, then the live run. */
export function threadRows(messages: Msg[], items: Msg[], liveRunning: boolean): ThreadRow[] {
  const rows: ThreadRow[] = messages.map((msg, i) => ({ msg, key: msg.id ?? (msg.local ? `local-${i}` : `msg-${i}`), live: false }));
  items.forEach((msg, i) => rows.push({ msg, key: `live-${i}`, live: liveRunning, liveIndex: i }));
  return rows;
}

const AGENT_KINDS = new Set<ThreadBlock["kind"]>(["assistant", "thinking", "tools", "knowledge"]);

export function buildThread(rows: ThreadRow[], opts: { cwd?: string; gates?: GatePlacement[] } = {}): ThreadBlock[] {
  // Tool results pair with their calls across the whole thread (an approval
  // card may sit between a call and its result).
  const toolRows = rows.filter((r) => isToolRow(r.msg));
  const calls = pairToolCalls(toolRows, opts.cwd);
  const callByKey = new Map<string, ToolCall>(calls.map((c) => [c.key, c]));
  const pairedResults = new Set<string>();
  {
    // Which result rows were attached to a call (vs. shown alone).
    const resultKeys = toolRows.filter((r) => r.msg.role === "tool_result").map((r) => r.key);
    for (const k of resultKeys) if (!callByKey.has(k)) pairedResults.add(k);
  }

  const gatesAt = new Map<number, string[]>();
  const gatesEnd: string[] = [];
  for (const g of opts.gates ?? []) {
    if (g.pos === undefined) gatesEnd.push(g.approvalId);
    else gatesAt.set(g.pos, [...(gatesAt.get(g.pos) ?? []), g.approvalId]);
  }

  const blocks: ThreadBlock[] = [];
  let tools: ToolCall[] = [];
  let toolsKey = "";
  let scope = 0;
  const sections = new Map<string, SubtaskSectionModel>();
  let planOrder = new Map<string, number>();

  const flushTools = () => {
    if (!tools.length) return;
    blocks.push({ kind: "tools", key: toolsKey, group: toolGroup(tools), segmentStart: false });
    tools = [];
  };
  const pushBlock = (b: ThreadBlock) => {
    flushTools();
    blocks.push(b);
  };
  const pushGates = (ids: string[] | undefined) => {
    if (!ids) return;
    for (const id of ids) pushBlock({ kind: "gate", key: `gate-${id}`, approvalId: id });
  };

  const sectionFor = (row: ThreadRow, meta: RowMeta, subtaskId: string): SubtaskSectionModel => {
    const key = `${scope}:${subtaskId}`;
    let s = sections.get(key);
    if (!s) {
      s = {
        key,
        subtaskId,
        title: str(meta.title) ?? `Teilaufgabe ${subtaskId}`,
        roleId: meta.review ? undefined : str(meta.roleId),
        roleName: meta.review ? undefined : str(meta.roleName),
        workerLabel: meta.review ? undefined : str(meta.worker),
        parts: [],
        hasError: false,
        live: row.live || row.liveIndex !== undefined,
        index: planOrder.get(subtaskId),
      };
      sections.set(key, s);
      pushBlock({ kind: "subtask", key: `subtask-${key}`, section: s });
    } else if (!meta.review && !meta.fixRound) {
      s.title = str(meta.title) ?? s.title;
      s.roleId = str(meta.roleId) ?? s.roleId;
      s.roleName = str(meta.roleName) ?? s.roleName;
      s.workerLabel = str(meta.worker) ?? s.workerLabel;
    }
    if (row.liveIndex !== undefined) s.live = true;
    return s;
  };

  rows.forEach((row) => {
    if (row.liveIndex !== undefined) pushGates(gatesAt.get(row.liveIndex));
    const { msg, key } = row;
    const meta = metaOf(msg);
    const at = rowTime(msg);

    if (isToolRow(msg)) {
      if (msg.role === "tool_result" && pairedResults.has(key)) return;
      const call = callByKey.get(key);
      if (!call) return;
      if (!tools.length) toolsKey = key;
      tools.push(call);
      return;
    }

    switch (msg.role) {
      case "user": {
        scope += 1;
        const loop = !!meta.loop || LOOP_PROMPT_RE.test(msg.content);
        pushBlock({ kind: "user", key, text: msg.content.replace(LOOP_PROMPT_RE, ""), loop, local: !!msg.local, at });
        return;
      }
      case "assistant": {
        const subtaskId = msg.subtaskId ?? str(meta.subtaskId);
        if (!subtaskId) {
          if (!msg.content.trim()) return;
          pushBlock({ kind: "assistant", key, text: msg.content, segmentStart: false, live: row.live, at });
          return;
        }
        const s = sectionFor(row, meta, subtaskId);
        if (meta.review) {
          const round = num(meta.round) ?? 1;
          const existing = s.parts.find((p) => p.kind === "review" && p.round === round);
          if (existing && existing.kind === "review") {
            existing.text = msg.content;
            existing.verdict = verdictOf(meta.verdict) ?? existing.verdict;
          } else {
            s.parts.push({
              kind: "review",
              key,
              round,
              maxRounds: num(meta.maxRounds),
              verdict: verdictOf(meta.verdict),
              text: msg.content,
              reviewerName: str(meta.roleName),
              reviewerLabel: str(meta.worker),
              at,
            });
          }
        } else if (num(meta.fixRound)) {
          s.parts.push({ kind: "fix", key, round: num(meta.fixRound)!, text: msg.content, at });
        } else {
          s.parts.push({ kind: "work", key, text: msg.content, at });
        }
        return;
      }
      case "error": {
        const subtaskId = msg.subtaskId ?? str(meta.subtaskId);
        if (subtaskId) {
          const s = sectionFor(row, meta, subtaskId);
          s.hasError = true;
          s.parts.push({ kind: "error", key, text: msg.content, round: num(meta.round) ?? num(meta.fixRound), review: !!meta.review });
          return;
        }
        pushBlock({ kind: "error", key, text: msg.content });
        return;
      }
      case "thinking":
        if (msg.content.trim()) pushBlock({ kind: "thinking", key, text: msg.content, segmentStart: false });
        return;
      case "knowledge": {
        const sources = Array.isArray(meta.sources) ? meta.sources.filter((s): s is string => typeof s === "string") : [];
        pushBlock({ kind: "knowledge", key, sources, segmentStart: false });
        return;
      }
      case "plan": {
        scope += 1;
        const subtasks = (Array.isArray(meta.subtasks) ? meta.subtasks : []) as PlannedSubtask[];
        planOrder = new Map(subtasks.map((s, i) => [s.id, i + 1]));
        const roles = (Array.isArray(meta.roles) ? meta.roles : []).filter((r): r is PlanRole => !!r && typeof r.id === "string");
        const workers = (Array.isArray(meta.workers) ? meta.workers : []).filter(
          (w): w is { id: string; label: string } => !!w && typeof (w as { id?: unknown }).id === "string",
        );
        pushBlock({ kind: "plan", key, task: msg.content, subtasks, roles, workers, live: row.liveIndex !== undefined });
        return;
      }
      case "synthesis":
        pushBlock({ kind: "synthesis", key, text: msg.content, live: row.live });
        return;
      case "system": {
        if (str(meta.loopEnd)) {
          pushBlock({ kind: "loop_end", key, reason: meta.loopEnd as string, iterations: num(meta.iterations) ?? 0 });
          return;
        }
        const it = ITERATION_RE.exec(msg.content);
        if (it || num(meta.iteration)) {
          pushBlock({
            kind: "iteration",
            key,
            iteration: num(meta.iteration) ?? Number(it![1]),
            max: num(meta.maxIterations) ?? Number(it![2]),
            fresh: typeof meta.freshContext === "boolean" ? meta.freshContext : undefined,
            at,
          });
          return;
        }
        if (num(meta.resumeAt) !== undefined) {
          pushBlock({ kind: "loop_wait", key, resumeAt: num(meta.resumeAt), text: msg.content });
          return;
        }
        if (msg.content.trim()) pushBlock({ kind: "system", key, text: msg.content.replace(/^⏹\s*/, "") });
        return;
      }
      default:
        return;
    }
  });
  flushTools();
  // Gates after the last live row, then seeded cards without a known position.
  const lastLive = rows.reduce((n, r) => (r.liveIndex !== undefined ? Math.max(n, r.liveIndex) : n), -1);
  for (const [pos, ids] of [...gatesAt].sort((a, b) => a[0] - b[0])) if (pos > lastLive) pushGates(ids);
  pushGates(gatesEnd);
  flushTools();

  // The agent's avatar line opens each run of agent output.
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (!AGENT_KINDS.has(b.kind)) continue;
    const prev = blocks[i - 1];
    const start = !prev || !AGENT_KINDS.has(prev.kind);
    if ("segmentStart" in b) (b as { segmentStart: boolean }).segmentStart = start;
  }
  return blocks;
}

/** Iteration number each block belongs to (for collapsing past iterations); 0 = none. */
export function iterationOf(blocks: ThreadBlock[]): number[] {
  const out: number[] = [];
  let cur = 0;
  let scope = 0;
  for (const b of blocks) {
    if (b.kind === "user") {
      cur = 0;
      scope += 1;
    }
    if (b.kind === "iteration") cur = scope * 1000 + b.iteration;
    if (b.kind === "loop_end") cur = 0;
    out.push(cur);
  }
  return out;
}

export interface LoopSettingsView {
  maxIterations?: number;
  completionPromise?: string;
  intervalSec?: number;
  freshContext?: boolean;
  stopOnError?: boolean;
}

export interface IterationEntry {
  iteration: number;
  startedAt?: number;
  /** Start of the next iteration (or the loop end) when known. */
  endedAt?: number;
  state: "done" | "current" | "failed";
}

export interface LoopTimeline {
  settings: LoopSettingsView | null;
  max: number;
  iterations: IterationEntry[];
  /** How the loop ended (null while it runs or when unknown). */
  end: { reason: string; iterations: number } | null;
}

/**
 * The latest loop of a thread: its settings (from the loop prompt's meta),
 * the iterations seen so far with the times the rows carry, and its end.
 */
export function latestLoop(rows: ThreadRow[]): LoopTimeline | null {
  let start = -1;
  for (let i = rows.length - 1; i >= 0; i--) {
    const m = rows[i].msg;
    if (m.role === "user" && (metaOf(m).loop || LOOP_PROMPT_RE.test(m.content))) {
      start = i;
      break;
    }
  }
  if (start < 0) {
    // A loop replayed from its start without the prompt row (attached mid-run).
    start = rows.findIndex((r) => r.msg.role === "system" && (ITERATION_RE.test(r.msg.content) || num(metaOf(r.msg).iteration)));
    if (start < 0) return null;
  }
  const rawSettings = metaOf(rows[start].msg).loop;
  const settings: LoopSettingsView | null =
    rawSettings && typeof rawSettings === "object"
      ? {
          maxIterations: num(rawSettings.maxIterations),
          completionPromise: str(rawSettings.completionPromise),
          intervalSec: num(rawSettings.intervalSec),
          freshContext: typeof rawSettings.freshContext === "boolean" ? rawSettings.freshContext : undefined,
          stopOnError: typeof rawSettings.stopOnError === "boolean" ? rawSettings.stopOnError : undefined,
        }
      : null;
  const iterations: IterationEntry[] = [];
  let max = settings?.maxIterations ?? 0;
  let end: LoopTimeline["end"] = null;
  let errorInCurrent = false;
  for (let i = start; i < rows.length; i++) {
    const m = rows[i].msg;
    const meta = metaOf(m);
    if (i > start && m.role === "user") break;
    if (m.role === "error") errorInCurrent = true;
    if (m.role !== "system") continue;
    if (str(meta.loopEnd)) {
      end = { reason: meta.loopEnd as string, iterations: num(meta.iterations) ?? iterations.length };
      const last = iterations[iterations.length - 1];
      if (last) {
        last.endedAt = rowTime(m);
        last.state = end.reason === "error" || (errorInCurrent && end.reason !== "promise") ? "failed" : "done";
      }
      break;
    }
    const it = ITERATION_RE.exec(m.content);
    const n = num(meta.iteration) ?? (it ? Number(it[1]) : undefined);
    if (n === undefined) continue;
    max = num(meta.maxIterations) ?? (it ? Number(it[2]) : max);
    const t = rowTime(m);
    const prev = iterations[iterations.length - 1];
    if (prev) {
      prev.endedAt = prev.endedAt ?? t;
      prev.state = errorInCurrent ? "failed" : "done";
    }
    errorInCurrent = false;
    iterations.push({ iteration: n, startedAt: t, state: "current" });
  }
  return { settings, max, iterations, end };
}
