import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { promptId, provider, model, input, output, latencyMs } = body;

  const result = await prisma.testResult.create({
    data: { promptId, provider, model, input, output, latencyMs },
  });

  return NextResponse.json({ result }, { status: 201 });
}
