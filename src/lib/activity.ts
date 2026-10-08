// App-wide activity snapshot (DESIGN.md §4.4): which sessions run right now
// and which approvals/questions wait for the user. Pure so it can be unit
// tested; the route (src/app/api/assistant/activity/route.ts) feeds it the
// in-memory run hub and approval registry. Client-safe: type imports only.

import type { RunKind, RunOrigin } from "@/lib/assistant/run-hub";
import type { ApprovalEvent } from "@/lib/assistant/approvals";

export interface ActivityRun {
  sessionId: string;
  title: string;
  cwd: string;
  provider: string;
  model: string;
  kind: RunKind;
  origin: RunOrigin;
  startedAt: number;
}

export interface ActivityPending {
  sessionId: string;
  sessionTitle: string;
  approvalId: string;
  type: "approval_request" | "question_request";
  kind?: "ask" | "plan";
  tool?: string;
  filePath?: string;
  command?: string;
  isWrite?: boolean;
  overwrites?: boolean;
  /** Deadline on the server's clock (epoch ms); compare with serverNow(), not Date.now(). */
  expiresAt?: number;
}

export interface ActivityResponse {
  /** Server clock (epoch ms) when the snapshot was built; clients derive their clock offset from it (src/lib/server-clock.ts). */
  serverTime: number;
  runs: ActivityRun[];
  pending: ActivityPending[];
}

export interface ActivitySession {
  id: string;
  title: string;
  cwd: string;
  provider: string;
  model: string;
}

/** The parts of a run-hub RunInfo the snapshot needs. */
export interface ActivityRunInfo {
  kind: RunKind;
  origin: RunOrigin;
  startedAt: number;
  done?: boolean;
}

// Bash commands can be whole heredocs; the activity rows show one line.
const MAX_COMMAND_CHARS = 500;

function clipCommand(command: string): string {
  return command.length > MAX_COMMAND_CHARS ? `${command.slice(0, MAX_COMMAND_CHARS)}…` : command;
}

function isRequest(type: string): type is ActivityPending["type"] {
  return type === "approval_request" || type === "question_request";
}

/**
 * Builds the /api/assistant/activity payload. Only the listed fields are
 * copied — never diffs, questions or plan text (they can be large and the
 * assistant loads full cards from the session itself).
 * Runs: newest first. Pending: soonest expiry first, unknown expiry last.
 */
export function buildActivity(
  sessions: ActivitySession[],
  getRun: (sessionId: string) => ActivityRunInfo | null | undefined,
  listPending: (sessionId: string) => ApprovalEvent[],
  now: number
): ActivityResponse {
  const runs: ActivityRun[] = [];
  const pending: ActivityPending[] = [];

  for (const s of sessions) {
    // Same display title as GET /api/assistant/sessions.
    const title = s.title || s.cwd;

    const run = getRun(s.id);
    if (run && !run.done) {
      runs.push({
        sessionId: s.id,
        title,
        cwd: s.cwd,
        provider: s.provider,
        model: s.model,
        kind: run.kind,
        origin: run.origin,
        startedAt: run.startedAt,
      });
    }

    for (const ev of listPending(s.id)) {
      if (!isRequest(ev.type) || ev.decision) continue;
      const item: ActivityPending = { sessionId: s.id, sessionTitle: title, approvalId: ev.approvalId, type: ev.type };
      if (ev.kind === "ask" || ev.kind === "plan") item.kind = ev.kind;
      if (typeof ev.tool === "string") item.tool = ev.tool;
      if (typeof ev.filePath === "string") item.filePath = ev.filePath;
      if (typeof ev.command === "string") item.command = clipCommand(ev.command);
      if (typeof ev.isWrite === "boolean") item.isWrite = ev.isWrite;
      if (typeof ev.overwrites === "boolean") item.overwrites = ev.overwrites;
      if (typeof ev.expiresAt === "number" && Number.isFinite(ev.expiresAt)) item.expiresAt = ev.expiresAt;
      pending.push(item);
    }
  }

  runs.sort((a, b) => b.startedAt - a.startedAt);
  pending.sort((a, b) => {
    if (a.expiresAt === undefined || b.expiresAt === undefined) {
      return (a.expiresAt === undefined ? 1 : 0) - (b.expiresAt === undefined ? 1 : 0);
    }
    return a.expiresAt - b.expiresAt;
  });

  return { serverTime: now, runs, pending };
}
