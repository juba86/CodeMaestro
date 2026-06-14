import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { stopSession } from "@/lib/assistant/runner";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const stopped = stopSession(id);
  await prisma.assistantSession.update({ where: { id }, data: { status: "idle" } }).catch(() => {});
  return NextResponse.json({ stopped });
}
