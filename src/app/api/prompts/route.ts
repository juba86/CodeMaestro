import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

export async function GET(req: NextRequest) {
  const search = req.nextUrl.searchParams.get("q") || "";
  const tag = req.nextUrl.searchParams.get("tag") || "";

  const where: Record<string, unknown> = {};

  if (search) {
    where.OR = [
      { title: { contains: search } },
      { description: { contains: search } },
      { content: { contains: search } },
    ];
  }

  if (tag) {
    where.tags = { some: { tag: { equals: tag } } };
  }

  const prompts = await prisma.prompt.findMany({
    where,
    include: { tags: true, _count: { select: { versions: true, testResults: true } } },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({ prompts });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { title, description, content, structured, tags } = body as {
    title: string;
    description?: string;
    content: string;
    structured?: string;
    tags?: string[];
  };

  const prompt = await prisma.prompt.create({
    data: {
      title,
      description: description || "",
      content,
      structured: structured || "{}",
      tags: tags
        ? { create: tags.map((t: string) => ({ tag: t })) }
        : undefined,
      versions: {
        create: {
          version: 1,
          content,
          structured: structured || "{}",
          changelog: "Initial version",
        },
      },
    },
    include: { tags: true, versions: true },
  });

  return NextResponse.json({ prompt }, { status: 201 });
}
