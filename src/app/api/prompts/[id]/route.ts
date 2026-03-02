import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const prompt = await prisma.prompt.findUnique({
    where: { id },
    include: {
      tags: true,
      versions: { orderBy: { version: "desc" } },
      testResults: { orderBy: { createdAt: "desc" }, take: 10 },
    },
  });

  if (!prompt) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ prompt });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { title, description, content, structured, tags, changelog } = body;

  const existing = await prisma.prompt.findUnique({
    where: { id },
    include: { versions: { orderBy: { version: "desc" }, take: 1 }, tags: true },
  });

  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const nextVersion = (existing.versions[0]?.version || 0) + 1;

  // Update prompt and create new version
  const prompt = await prisma.prompt.update({
    where: { id },
    data: {
      title: title ?? existing.title,
      description: description ?? existing.description,
      content: content ?? existing.content,
      structured: structured ?? existing.structured,
      versions: content
        ? {
            create: {
              version: nextVersion,
              content,
              structured: structured || existing.structured,
              changelog: changelog || `Version ${nextVersion}`,
            },
          }
        : undefined,
    },
    include: { tags: true, versions: { orderBy: { version: "desc" } } },
  });

  // Update tags if provided
  if (tags) {
    await prisma.promptTag.deleteMany({ where: { promptId: id } });
    await prisma.promptTag.createMany({
      data: tags.map((t: string) => ({ promptId: id, tag: t })),
    });
  }

  return NextResponse.json({ prompt });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await prisma.prompt.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
