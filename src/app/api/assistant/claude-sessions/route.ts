import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { resolveWorkdir } from "@/lib/assistant/security";
import { listClaudeSessions } from "@/lib/assistant/claude-sessions";

export const runtime = "nodejs";

/**
 * Claude Code's own conversations of a project folder (newest first, at most
 * 20), for "Projekt fortsetzen" in the New-Session sheet. A conversation that
 * already backs a CodeMaestro session (its externalId) carries that session's
 * id as `linkedSessionId`: it is opened instead of linked a second time.
 */
export async function GET(req: NextRequest) {
  let cwd: string;
  try {
    cwd = await resolveWorkdir(req.nextUrl.searchParams.get("cwd") || "");
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid working directory", code: "INVALID_CWD" },
      { status: 400 }
    );
  }
  try {
    const list = await listClaudeSessions(cwd, { limit: 20 });
    const linked = list.length
      ? await prisma.assistantSession.findMany({
          where: { externalId: { in: list.map((s) => s.id) } },
          select: { id: true, externalId: true },
        })
      : [];
    const byExternal = new Map(linked.map((s) => [s.externalId, s.id]));
    return NextResponse.json({
      sessions: list.map((s) => {
        const linkedSessionId = byExternal.get(s.id);
        return linkedSessionId ? { ...s, linkedSessionId } : s;
      }),
    });
  } catch (err) {
    console.error("[GET /api/assistant/claude-sessions]", err);
    return NextResponse.json({ error: "Internal server error", code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
