import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { resolveWorkdir } from "@/lib/assistant/security";
import { getDev, startDev, detectStartCommand, findFreePort } from "@/lib/assistant/devserver";
import { z } from "zod";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const status = getDev(id);
  if (status.running || status.port) return NextResponse.json(status);

  // Not running — suggest a command + free port for this project.
  const session = await prisma.assistantSession.findUnique({ where: { id } });
  if (!session) return NextResponse.json({ running: false });
  const port = await findFreePort(4300);
  const { command, framework } = await detectStartCommand(session.cwd, port);
  return NextResponse.json({ running: false, suggestion: { command, port, framework } });
}

const startSchema = z.object({
  command: z.string().min(1).max(2000),
  port: z.coerce.number().int().min(1024).max(65535),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON", code: "INVALID_JSON" }, { status: 400 }); }
  const parsed = startSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid command/port", code: "VALIDATION_ERROR" }, { status: 400 });

  const session = await prisma.assistantSession.findUnique({ where: { id } });
  if (!session) return NextResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });

  let cwd: string;
  try { cwd = await resolveWorkdir(session.cwd); } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid cwd", code: "INVALID_CWD" }, { status: 400 });
  }

  startDev(id, cwd, parsed.data.command, parsed.data.port);
  return NextResponse.json(getDev(id));
}
