import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ docId: string }> }
) {
  const { docId } = await params;
  try {
    await prisma.knowledgeDoc.delete({ where: { id: docId } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
  }
}
