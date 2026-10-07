#!/usr/bin/env node
// Claude Code PreToolUse hook. Reads the tool event from stdin, asks the
// CodeMaestro server for a user decision (which surfaces an approve/deny card or
// a question in the browser / Telegram), and returns the decision to Claude Code.
//
// Fails closed: any error produces an explicit "deny" (exit 0 + JSON), and an
// unexpected crash exits with code 2 (a blocking error in Claude Code), so a
// broken bridge can never silently let a gated tool run.
//
// Env: PB_BASE_URL (the app's own URL), PB_SESSION_ID (assistant session id),
//      PB_HOOK_TOKEN (per-process secret), PB_APPROVAL_TIMEOUT_MS (overall wait).

function out(decision, reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision, // "allow" | "deny"
      permissionDecisionReason: reason || "",
    },
  }));
}

process.on("uncaughtException", (e) => {
  process.stderr.write(`Approval-Hook-Fehler: ${e?.message || e}\n`);
  process.exit(2);
});
process.on("unhandledRejection", (e) => {
  process.stderr.write(`Approval-Hook-Fehler: ${e?.message || e}\n`);
  process.exit(2);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(url, init, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  // Collect raw bytes and decode once — decoding per chunk would corrupt
  // multi-byte UTF-8 characters split across chunk boundaries.
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");

  let event = {};
  try { event = JSON.parse(raw); } catch { /* handled below */ }
  if (!event.tool_name) { out("deny", "Approval-Bridge: ungültiges Hook-Event."); return; }

  const base = process.env.PB_BASE_URL;
  const sessionId = process.env.PB_SESSION_ID;
  const token = process.env.PB_HOOK_TOKEN || "";
  if (!base || !sessionId) { out("deny", "Approval-Bridge nicht konfiguriert."); return; }
  const headers = { "Content-Type": "application/json", "x-codemaestro-hook-token": token };

  const overall = Number(process.env.PB_APPROVAL_TIMEOUT_MS) || 1_800_000;
  const deadline = Date.now() + overall + 30_000;

  let created;
  try {
    created = await call(`${base}/api/assistant/approval/request`, {
      method: "POST",
      headers,
      body: JSON.stringify({ sessionId, tool: event.tool_name, input: event.tool_input || {} }),
    }, 30_000);
  } catch (e) {
    out("deny", "Approval-Bridge nicht erreichbar: " + (e?.message || e));
    return;
  }
  if (created?.decision) { out(created.decision === "allow" ? "allow" : "deny", created.reason); return; }
  const approvalId = created?.approvalId;
  if (!approvalId) { out("deny", "Approval-Bridge: keine Freigabe-ID erhalten."); return; }

  // Long-poll in short windows until decided, expired, or the deadline passes.
  let failures = 0;
  while (Date.now() < deadline) {
    try {
      const r = await call(
        `${base}/api/assistant/approval/${encodeURIComponent(approvalId)}/wait?timeout=25`,
        { headers },
        40_000
      );
      failures = 0;
      if (r?.status === "decided") { out(r.decision === "allow" ? "allow" : "deny", r.reason); return; }
      if (r?.status !== "pending") { out("deny", "Freigabe abgelaufen."); return; }
    } catch {
      // Transient (server busy/restarting): retry a few times, then give up.
      if (++failures >= 5) { out("deny", "Approval-Bridge nicht erreichbar."); return; }
      await sleep(2000);
    }
  }
  out("deny", "Freigabe-Timeout.");
}

main().catch((e) => {
  process.stderr.write(`Approval-Hook-Fehler: ${e?.message || e}\n`);
  process.exit(2);
});
