// CodeMaestro approval gate for the pi coding agent (loaded with `pi -e`).
// Every gated tool call (write/edit, plus bash in "all" mode) is sent to the
// CodeMaestro server — the same HTTP contract as assistant-approval-hook.mjs —
// which shows an approve/deny card (with diff) in the browser / Telegram. The
// call only runs once the user allows it.
//
// Fails closed: misconfiguration, an unreachable server, a timeout or any
// error blocks the call (pi also blocks when a tool_call handler throws, and
// refuses to start when this file fails to load).
//
// Env (set by the runner): PB_BASE_URL, PB_SESSION_ID, PB_HOOK_TOKEN,
// PB_APPROVAL_TIMEOUT_MS, CM_PI_GATED (comma list of gated pi tool names).

import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Structural subset of pi's ExtensionAPI — types only, so loading this file
// needs nothing from the pi package.
interface ToolCallEvent {
  type: "tool_call";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}
interface ToolCallContext {
  cwd: string;
  signal: AbortSignal | undefined;
}
type ToolCallResult = { block: true; reason: string } | undefined;
interface PiExtensionAPI {
  on(event: "tool_call", handler: (event: ToolCallEvent, ctx: ToolCallContext) => Promise<ToolCallResult>): unknown;
}

type Json = Record<string, unknown>;

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

/** pi's own path resolution (unicode spaces, "@" prefix, "~", file://, cwd). */
export function resolvePiPath(raw: unknown, cwd: string): string {
  let p = String(raw ?? "").replace(UNICODE_SPACES, " ");
  if (p.startsWith("@")) p = p.slice(1);
  if (p === "~") p = os.homedir();
  else if (p.startsWith("~/")) p = path.join(os.homedir(), p.slice(2));
  else if (p.startsWith("file://")) {
    try { p = fileURLToPath(p); } catch { /* keep */ }
  }
  return path.resolve(cwd, p);
}

/** pi's edit normalization: edits[] / JSON string / single object / legacy top-level oldText+newText. */
function editList(input: Json): Json[] {
  let edits: unknown = input.edits;
  if (typeof edits === "string") {
    try { edits = JSON.parse(edits); } catch { /* keep */ }
  }
  const list: Json[] = Array.isArray(edits)
    ? edits.filter((e): e is Json => !!e && typeof e === "object")
    : edits && typeof edits === "object" ? [edits as Json] : [];
  if (typeof input.oldText === "string" && typeof input.newText === "string") {
    list.push({ oldText: input.oldText, newText: input.newText });
  }
  return list;
}

/**
 * Maps a pi tool call onto the Claude Code shape the approval cards and diffs
 * understand: write → Write, edit → MultiEdit, bash → Bash (absolute paths).
 */
export function toClaudeToolCall(toolName: string, input: Json, cwd: string): { tool: string; input: Json } {
  if (toolName === "write") {
    return { tool: "Write", input: { file_path: resolvePiPath(input.path, cwd), content: String(input.content ?? "") } };
  }
  if (toolName === "edit") {
    const edits = editList(input).map((e) => ({ old_string: String(e.oldText ?? ""), new_string: String(e.newText ?? "") }));
    return { tool: "MultiEdit", input: { file_path: resolvePiPath(input.path, cwd), edits } };
  }
  if (toolName === "bash") {
    return { tool: "Bash", input: { command: String(input.command ?? "") } };
  }
  return { tool: toolName, input };
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason ?? new Error("aborted")); return; }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(signal.reason ?? new Error("aborted")); }, { once: true });
  });

async function call(url: string, init: RequestInit, timeoutMs: number, outer?: AbortSignal): Promise<Json> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const res = await fetch(url, { ...init, signal: outer ? AbortSignal.any([timeout, outer]) : timeout });
  const body = (await res.json()) as unknown;
  return body && typeof body === "object" ? (body as Json) : {};
}

const block = (reason: string): ToolCallResult => ({ block: true, reason });

export default function codemaestroApproval(pi: PiExtensionAPI): void {
  const base = process.env.PB_BASE_URL;
  const sessionId = process.env.PB_SESSION_ID;
  const token = process.env.PB_HOOK_TOKEN ?? "";
  // Unset → gate every mutating tool (fail closed).
  const gated = new Set(
    (process.env.CM_PI_GATED || "write,edit,bash").split(",").map((s) => s.trim()).filter(Boolean)
  );
  const overall = Number(process.env.PB_APPROVAL_TIMEOUT_MS) || 1_800_000;

  pi.on("tool_call", async (event, ctx) => {
    if (!gated.has(event.toolName)) return undefined;
    if (!base || !sessionId) return block("Approval-Bridge nicht konfiguriert.");
    const headers = { "Content-Type": "application/json", "x-codemaestro-hook-token": token };
    const signal = ctx.signal;
    try {
      const { tool, input } = toClaudeToolCall(event.toolName, event.input ?? {}, ctx.cwd);
      const created = await call(`${base}/api/assistant/approval/request`, {
        method: "POST",
        headers,
        body: JSON.stringify({ sessionId, tool, input }),
      }, 30_000, signal);
      if (created.decision) {
        return created.decision === "allow" ? undefined : block(String(created.reason || "Abgelehnt."));
      }
      const approvalId = created.approvalId;
      if (typeof approvalId !== "string" || !approvalId) return block("Approval-Bridge: keine Freigabe-ID erhalten.");

      // Long-poll in short windows until decided, expired, or the deadline passes.
      const deadline = Date.now() + overall + 30_000;
      let failures = 0;
      while (Date.now() < deadline) {
        if (signal?.aborted) return block("Ausführung gestoppt.");
        try {
          const r = await call(
            `${base}/api/assistant/approval/${encodeURIComponent(approvalId)}/wait?timeout=25`,
            { headers },
            40_000,
            signal
          );
          failures = 0;
          if (r.status === "decided") {
            return r.decision === "allow" ? undefined : block(String(r.reason || "Vom Benutzer abgelehnt."));
          }
          if (r.status !== "pending") return block("Freigabe abgelaufen.");
        } catch (e) {
          if (signal?.aborted) return block("Ausführung gestoppt.");
          // Transient (server busy/restarting): retry a few times, then give up.
          if (++failures >= 5) return block(`Approval-Bridge nicht erreichbar: ${e instanceof Error ? e.message : String(e)}`);
          await sleep(2000, signal);
        }
      }
      return block("Freigabe-Timeout.");
    } catch (e) {
      return block(signal?.aborted ? "Ausführung gestoppt." : `Freigabe fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
}
