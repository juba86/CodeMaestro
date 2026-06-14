import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; caseId: string }> }
) {
  const { id, caseId } = await params;
  try {
    await prisma.testCase.delete({ where: { id: caseId, promptId: id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
  }
}
