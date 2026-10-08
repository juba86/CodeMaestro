import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { orchestrateSchema, formatZodError } from "@/lib/validation/schemas";
import { planSubtasks, discoverAllWorkers, canEditFiles, toWorkerInfo } from "@/lib/assistant/orchestrator";
import { resolveOrchestra } from "@/lib/assistant/orchestra";
import { resolveWorkdir } from "@/lib/assistant/security";
import { SessionBusyError, isSessionBusy } from "@/lib/assistant/run-hub";
import { pendingHandoffContext, toSessionRow } from "@/lib/assistant/session-run";

export const runtime = "nodejs";
export const maxDuration = 600;

/**
 * Hybrid mode, step 1: plans without executing so the user can edit the
 * worker assignments (synchronous). Refused while a run is active — the
 * planner CLI shares the session's process key, and a plan made against a
 * working directory that is being changed would be stale anyway.
 */
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
  const parsed = orchestrateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error), code: "VALIDATION_ERROR" }, { status: 400 });
  }
  const { prompt, preference, clientProviders, plannerWorkerId } = parsed.data;

  const session = await prisma.assistantSession.findUnique({ where: { id } });
  if (!session) {
    return NextResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
  }
  if (isSessionBusy(id)) {
    return NextResponse.json({ error: new SessionBusyError().message, code: "SESSION_BUSY" }, { status: 409 });
  }
  try {
    await resolveWorkdir(session.cwd);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid working directory", code: "INVALID_CWD" },
      { status: 400 }
    );
  }

  try {
    // The planner is a tool-less, read-only text run; abort it when the
    // client goes away so no orphaned CLI keeps running.
    const row = toSessionRow(session);
    const orchestra = await resolveOrchestra(parsed.data.orchestra);
    const { subtasks, costUsd } = await planSubtasks(row, prompt, {
      preference,
      clientProviders,
      plannerWorkerId,
      orchestra,
      history: await pendingHandoffContext(id),
      signal: req.signal,
    });
    if (costUsd > 0) {
      await prisma.assistantSession
        .update({ where: { id }, data: { totalCostUsd: { increment: costUsd } } })
        .catch((err) => console.error("[orchestrate/plan] cost bookkeeping failed", err));
    }
    if (req.signal.aborted) {
      return NextResponse.json({ error: "Planung abgebrochen.", code: "ABORTED" }, { status: 499 });
    }
    // Offer the full pool (incl. every local Ollama model + configured cloud APIs)
    // for manual reassignment. editsFiles reflects this session (a Gemini
    // worker is read-only under the approval gate / sandbox).
    // `roles` (the enabled orchestra roles) label the subtasks' roleId.
    const allWorkers = await discoverAllWorkers(clientProviders);
    return NextResponse.json({
      workers: allWorkers.map((w) => ({ ...toWorkerInfo(w), editsFiles: canEditFiles(w, row) })),
      subtasks,
      roles: orchestra.roles.filter((r) => r.enabled).map((r) => ({ id: r.id, name: r.name, editsFiles: r.editsFiles })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Planung fehlgeschlagen", code: "PLAN_FAILED" },
      { status: 502 }
    );
  }
}
