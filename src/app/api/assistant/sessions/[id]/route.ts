import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { stopSession } from "@/lib/assistant/runner";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await prisma.assistantSession.findUnique({
    where: { id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!session) {
    return NextResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
  }
  return NextResponse.json({ session });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  stopSession(id);
  try {
    await prisma.assistantSession.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
  }
}
