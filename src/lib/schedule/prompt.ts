// The context block a scheduled run starts with: who started it and how an
// unattended agent should behave. Pure; the server prepends it to the task.

import { SCHEDULE_PAYLOAD_MAX, type ScheduleFireReason } from "./types";

export interface ScheduleBlockInput {
  name: string;
  /** 1-based number of this run of the schedule. */
  runNo: number;
  reason: ScheduleFireReason;
  cron: string;
  /** When the run was started (epoch ms, server time). */
  at: number;
  /** Body of a webhook call, handed to the agent verbatim (clipped). */
  payload?: string;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** "2026-10-14 09:00" in server local time. */
export function localStamp(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function reasonText(i: ScheduleBlockInput): string {
  if (i.reason === "webhook") return "triggered by a webhook call";
  if (i.reason === "manual") return "started by hand from the schedule's menu";
  return i.cron ? `cron "${i.cron}"` : "on schedule";
}

export function clipPayload(payload: string, max = SCHEDULE_PAYLOAD_MAX): string {
  const t = payload.trim();
  return t.length > max ? `${t.slice(0, max)}\n… (gekürzt)` : t;
}

export function scheduleBlock(i: ScheduleBlockInput): string {
  const lines = [
    "<schedule>",
    `This turn was started automatically by the schedule "${i.name}" (run #${i.runNo}, ${reasonText(i)}, ${localStamp(i.at)}), not by a person typing. Nobody is watching live.`,
    "- Work autonomously. Do not ask questions; if something truly blocks you, say so in your report and stop.",
    "- Stay within the task below; do not start unrelated work.",
    "- Finish with a short report. Its first line must be a one-sentence headline (it becomes a notification), followed by what you checked, what you changed and what needs a human.",
  ];
  const payload = i.payload ? clipPayload(i.payload) : "";
  if (payload) lines.push("<trigger_payload>", payload, "</trigger_payload>");
  lines.push("</schedule>");
  return lines.join("\n");
}

/** The full prompt of a scheduled run: context block, then the task. */
export function schedulePrompt(i: ScheduleBlockInput, task: string): string {
  return `${scheduleBlock(i)}\n\n${task.trim()}`;
}
