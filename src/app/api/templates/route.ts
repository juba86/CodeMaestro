import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

export async function GET(req: NextRequest) {
  const category = req.nextUrl.searchParams.get("category") || "";

  const where = category ? { category } : {};

  const templates = await prisma.template.findMany({
    where,
    orderBy: [{ isBuiltIn: "desc" }, { name: "asc" }],
  });

  return NextResponse.json({ templates });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { slug, name, description, category, content, structured, isBuiltIn } = body;

  const template = await prisma.template.create({
    data: { slug, name, description, category, content, structured, isBuiltIn },
  });

  return NextResponse.json({ template }, { status: 201 });
}
