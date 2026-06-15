#!/usr/bin/env node
// Claude Code PreToolUse hook. Reads the tool event from stdin, asks the
// PromptBuilder server for a user decision (which surfaces an approve/deny card
// in the browser), and returns the decision to Claude Code.
//
// Env: PB_BASE_URL (the app's own URL), PB_SESSION_ID (assistant session id).

function out(decision, reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision, // "allow" | "deny"
      permissionDecisionReason: reason || "",
    },
  }));
}

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;

  let event = {};
  try { event = JSON.parse(raw); } catch { /* ignore */ }

  const base = process.env.PB_BASE_URL;
  const sessionId = process.env.PB_SESSION_ID;
  if (!base || !sessionId) { out("deny", "Approval-Bridge nicht konfiguriert."); return; }

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 330_000);
  try {
    const res = await fetch(`${base}/api/assistant/approval/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        tool: event.tool_name,
        input: event.tool_input || {},
      }),
      signal: controller.signal,
    });
    clearTimeout(t);
    const data = await res.json();
    out(data.decision === "allow" ? "allow" : "deny", data.reason || "");
  } catch (e) {
    clearTimeout(t);
    out("deny", "Approval-Bridge nicht erreichbar: " + (e?.message || e));
  }
}

main();
