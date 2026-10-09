// The shared work journal of a working directory.
//
// Agents in CodeMaestro do not share a conversation: a Claude Code session, a
// pi session, a Telegram turn and an orchestration each keep their own. When
// they work on the same project, each one must still know what the others
// changed — otherwise it works from a stale picture of the code. So every
// finished turn or orchestration that changed something leaves an entry here
// (who, what was asked, what was done, which files — measured with git), and
// every turn starts with the entries its agent has not seen yet, plus a note
// when another agent is working in the same directory right now.
//
// Everything here is best effort: the journal must never block or fail a run.

import { prisma } from "@/lib/db/client";
import { providerLabel } from "@/lib/labels";
import { activeSessionIds } from "./run-hub";
import { clipMiddle, handoffNote } from "./handoff";

export interface WorkEntry {
  agent: string;
  task: string;
  summary: string;
  files: string[];
  status: string;
  createdAt: Date;
}

export interface ActiveElsewhere {
  agent: string;
  title: string;
}

const MAX_TASK_CHARS = 500;
const MAX_SUMMARY_CHARS = 2_000;
const MAX_FILES = 200;
// A session that was never synced starts with the recent past, not the full history.
const FIRST_SYNC_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const UNSEEN_LIMIT = 5;

/** "Claude Code", "pi · kolibri" — how an agent is named in the journal. */
export function agentLabel(provider: string, model?: string | null): string {
  const label = providerLabel(provider);
  // With a model the provider's short name is enough ("pi · lokale Modelle" → "pi").
  return model ? `${label.split(" · ")[0]} · ${model}` : label;
}

function parseFiles(raw: string): string[] {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((f): f is string => typeof f === "string") : [];
  } catch {
    return [];
  }
}

type Row = { agent: string; task: string; summary: string; files: string; status: string; createdAt: Date };
const toEntry = (r: Row): WorkEntry => ({ ...r, files: parseFiles(r.files) });
const SELECT = { agent: true, task: true, summary: true, files: true, status: true, createdAt: true } as const;

/** Records finished work. `summary` is the agent's closing report (clipped here). */
export async function recordWork(e: {
  cwd: string;
  sessionId: string;
  agent: string;
  task: string;
  summary: string;
  files?: string[];
  status?: "done" | "error" | "stopped";
}): Promise<void> {
  try {
    await prisma.workLogEntry.create({
      data: {
        cwd: e.cwd,
        sessionId: e.sessionId,
        agent: e.agent.slice(0, 300),
        task: clipMiddle(e.task.trim(), MAX_TASK_CHARS),
        summary: handoffNote(e.summary, MAX_SUMMARY_CHARS) || "(kein Bericht)",
        files: JSON.stringify((e.files ?? []).slice(0, MAX_FILES)),
        status: e.status ?? "done",
      },
    });
  } catch (err) {
    console.error("[work-journal] entry not recorded", err instanceof Error ? err.message : err);
  }
}

/**
 * Work of OTHER sessions in the same directory that this session's agent has
 * not been told about yet (oldest first, the newest few). `readAt` is what to
 * pass to markSynced once the agent has actually received them.
 */
export async function unseenWork(sessionId: string, cwd: string): Promise<{ entries: WorkEntry[]; readAt: Date }> {
  const readAt = new Date();
  try {
    const s = await prisma.assistantSession.findUnique({ where: { id: sessionId }, select: { syncedAt: true } });
    const since = s?.syncedAt ?? new Date(readAt.getTime() - FIRST_SYNC_WINDOW_MS);
    const rows = await prisma.workLogEntry.findMany({
      where: { cwd, sessionId: { not: sessionId }, createdAt: { gt: since } },
      orderBy: { createdAt: "desc" },
      take: UNSEEN_LIMIT,
      select: SELECT,
    });
    return { entries: rows.reverse().map(toEntry), readAt };
  } catch {
    return { entries: [], readAt };
  }
}

/**
 * This session's own latest entries — for agents that work for the session
 * without sharing its conversation (orchestra workers other than a Claude
 * Code fork of a Claude Code session).
 */
export async function ownRecentWork(sessionId: string, limit = 3): Promise<WorkEntry[]> {
  try {
    const rows = await prisma.workLogEntry.findMany({
      where: { sessionId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: SELECT,
    });
    return rows.reverse().map(toEntry);
  } catch {
    return [];
  }
}

/** Other sessions with a run in the same directory right now. */
export async function activeElsewhere(sessionId: string, cwd: string): Promise<ActiveElsewhere[]> {
  try {
    const ids = activeSessionIds().filter((id) => id !== sessionId);
    if (!ids.length) return [];
    const rows = await prisma.assistantSession.findMany({
      where: { id: { in: ids }, cwd },
      select: { provider: true, model: true, title: true },
    });
    return rows.map((r) => ({ agent: agentLabel(r.provider, r.model), title: clipMiddle(r.title || "", 160) }));
  } catch {
    return [];
  }
}

/** The session's agent has been told everything up to `readAt`. */
export async function markSynced(sessionId: string, readAt: Date): Promise<void> {
  try {
    await prisma.assistantSession.update({ where: { id: sessionId }, data: { syncedAt: readAt } });
  } catch (err) {
    console.error("[work-journal] sync marker not stored", err instanceof Error ? err.message : err);
  }
}

// --- Prompt text (pure) -----------------------------------------------------------

const ENTRY_CHARS = 1_200;
const FILES_SHOWN = 30;

function entryBlock(e: WorkEntry): string {
  const files = e.files.length
    ? `Files changed: ${e.files.slice(0, FILES_SHOWN).join(", ")}${e.files.length > FILES_SHOWN ? `, … (+${e.files.length - FILES_SHOWN} more)` : ""}\n`
    : "";
  const status = e.status === "done" ? "" : ` status="${e.status === "stopped" ? "stopped before it finished" : "ended with an error"}"`;
  const by = e.agent.replace(/["<>\n]/g, " ");
  return `<work by="${by}" at="${e.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC"${status}>\n<asked>${e.task}</asked>\n${files}${clipMiddle(e.summary, ENTRY_CHARS)}\n</work>`;
}

/**
 * What other agents did in this directory since this agent last looked, and
 * who is working here right now. "" when there is nothing to tell.
 */
export function syncBlock(entries: WorkEntry[], active: ActiveElsewhere[] = []): string {
  if (!entries.length && !active.length) return "";
  const parts: string[] = [];
  if (entries.length) {
    parts.push(
      `Since you last worked here, other agents changed this project. Their work is on disk; your picture of the affected files may be stale, so re-read a file named below before you rely on it or edit it, and build on this work instead of redoing it.\n${entries.map(entryBlock).join("\n")}`
    );
  }
  if (active.length) {
    const who = active.map((a) => `${a.agent}${a.title ? ` ("${a.title.replace(/\s+/g, " ")}")` : ""}`).join("; ");
    parts.push(
      `Another agent is working in this directory right now: ${who}. Files can change under you: read a file again right before you edit it, keep your changes to what your task needs, and do not revert changes you did not make.`
    );
  }
  return `<team_sync>\n${parts.join("\n\n")}\n</team_sync>`;
}

/** Earlier work of this session, for an agent that does not share its conversation. "" when none. */
export function recapBlock(entries: WorkEntry[]): string {
  if (!entries.length) return "";
  return `<session_recap>\nEarlier work in this session (other agents or earlier runs; already on disk):\n${entries.map(entryBlock).join("\n")}\n</session_recap>`;
}
