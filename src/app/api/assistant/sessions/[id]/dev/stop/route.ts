import { NextRequest, NextResponse } from "next/server";
import { stopDev } from "@/lib/assistant/devserver";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const stopped = stopDev(id);
  return NextResponse.json({ stopped });
}
