import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { assistantMessageSchema, formatZodError } from "@/lib/validation/schemas";
import { runTurn, type NormalizedEvent, type AssistantSessionRow } from "@/lib/assistant/runner";
import { resolveWorkdir } from "@/lib/assistant/security";
import { registerEmitter, unregisterEmitter } from "@/lib/assistant/approvals";
import { augmentPromptWithKnowledge } from "@/lib/knowledge/retrieve";

export const runtime = "nodejs";
export const maxDuration = 3600;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body", code: "INVALID_JSON" }, { status: 400 });
  }
  const parsed = assistantMessageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error), code: "VALIDATION_ERROR" }, { status: 400 });
  }
  const { prompt, apiKey, useKnowledge } = parsed.data;

  const session = await prisma.assistantSession.findUnique({ where: { id } });
  if (!session) {
    return NextResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
  }
  if (session.status === "running") {
    return NextResponse.json(
      { error: "In dieser Session läuft bereits eine Aufgabe. Bitte erst stoppen.", code: "SESSION_BUSY" },
      { status: 409 }
    );
  }

  // Re-validate the working directory at run time (defense in depth).
  try {
    await resolveWorkdir(session.cwd);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid working directory", code: "INVALID_CWD" },
      { status: 400 }
    );
  }

  // Persist the user turn and mark the session running.
  await prisma.assistantMessage.create({ data: { sessionId: id, role: "user", content: prompt } });
  await prisma.assistantSession.update({
    where: { id },
    data: { status: "running", title: session.title || prompt.slice(0, 80) },
  });

  const sessionRow: AssistantSessionRow = {
    id: session.id,
    externalId: session.externalId,
    provider: session.provider,
    model: session.model,
    cwd: session.cwd,
    permissionMode: session.permissionMode,
    allowedTools: session.allowedTools,
    approvalMode: session.approvalMode,
    sandbox: session.sandbox,
  };

  const encoder = new TextEncoder();
  const toPersist: { role: string; content: string; meta: string }[] = [];
  let assistantText = "";

  const stream = new ReadableStream({
    async start(controller) {
      // Enqueue safely: if the client has gone (e.g. mobile standby dropped the
      // connection) the controller is closed and enqueue throws — we ignore that
      // and keep running so the work still completes and persists to the DB.
      const send = (e: NormalizedEvent) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`)); } catch { /* client gone */ }
      };

      // Let the approval hook push approve/deny cards into this live stream.
      registerEmitter(id, (e) => { try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`)); } catch { /* gone */ } });

      const emit = (e: NormalizedEvent) => {
        send(e);
        if (e.type === "text" && e.content) {
          assistantText += e.content;
        } else if (e.type === "tool_use") {
          toPersist.push({
            role: "tool_use",
            content: e.name || "tool",
            meta: JSON.stringify({ name: e.name, input: e.input, toolUseId: e.toolUseId }),
          });
        } else if (e.type === "tool_result") {
          toPersist.push({
            role: "tool_result",
            content: (e.content || "").slice(0, 8000),
            meta: JSON.stringify({ toolUseId: e.toolUseId, isError: e.isError }),
          });
        } else if (e.type === "error" && e.content) {
          toPersist.push({ role: "error", content: e.content.slice(0, 4000), meta: "{}" });
        }
      };

      // RAG: prepend relevant knowledge-base context (shared retrieval path).
      // Graceful — a no-op when disabled, the index is empty, or Ollama is down,
      // so the turn always runs. We persist the raw user prompt above and only
      // augment what the model receives here.
      let effectivePrompt = prompt;
      try {
        const aug = await augmentPromptWithKnowledge(prompt, { enabled: useKnowledge });
        if (aug.injected) {
          effectivePrompt = aug.prompt;
          emit({ type: "knowledge", sources: aug.sources.map((s) => s.docTitle) });
        }
      } catch { /* never let RAG block the turn */ }

      let result;
      try {
        result = await runTurn(sessionRow, effectivePrompt, apiKey, emit);
      } catch (err) {
        send({ type: "error", content: err instanceof Error ? err.message : "Runner failed" });
        result = { externalId: session.externalId, costUsd: 0, isError: true };
      } finally {
        unregisterEmitter(id);
      }

      // Persist the assistant text first (in order), then tool events.
      const rows = [];
      if (assistantText.trim()) {
        rows.push({ sessionId: id, role: "assistant", content: assistantText.trim(), meta: "{}" });
      }
      for (const p of toPersist) rows.push({ sessionId: id, ...p });
      if (rows.length) await prisma.assistantMessage.createMany({ data: rows });

      await prisma.assistantSession.update({
        where: { id },
        data: {
          status: result.isError ? "error" : "idle",
          externalId: result.externalId ?? session.externalId,
          totalCostUsd: { increment: result.costUsd || 0 },
        },
      });

      try { controller.enqueue(encoder.encode("data: [DONE]\n\n")); } catch { /* client gone */ }
      try { controller.close(); } catch { /* already closed */ }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
