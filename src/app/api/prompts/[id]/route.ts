import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { updatePromptSchema, formatZodError } from "@/lib/validation/schemas";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id || id.length < 1) {
    return NextResponse.json(
      { error: "Invalid prompt ID", code: "INVALID_ID" },
      { status: 400 }
    );
  }

  const prompt = await prisma.prompt.findUnique({
    where: { id },
    include: {
      tags: true,
      versions: { orderBy: { version: "desc" } },
      testResults: { orderBy: { createdAt: "desc" }, take: 10 },
    },
  });

  if (!prompt) {
    return NextResponse.json(
      { error: "Not found", code: "NOT_FOUND" },
      { status: 404 }
    );
  }

  return NextResponse.json({ prompt });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id || id.length < 1) {
      return NextResponse.json(
        { error: "Invalid prompt ID", code: "INVALID_ID" },
        { status: 400 }
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body", code: "INVALID_JSON" },
        { status: 400 }
      );
    }

    const result = updatePromptSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: formatZodError(result.error), code: "VALIDATION_ERROR" },
        { status: 400 }
      );
    }

    const { title, description, content, structured, tags, changelog } = result.data;

    const existing = await prisma.prompt.findUnique({
      where: { id },
      include: { versions: { orderBy: { version: "desc" }, take: 1 }, tags: true },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Not found", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    const nextVersion = (existing.versions[0]?.version || 0) + 1;

    // Use a transaction for atomic tag + prompt update (response is re-fetched below)
    await prisma.$transaction(async (tx) => {
      await tx.prompt.update({
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

      // Update tags atomically if provided
      if (tags) {
        await tx.promptTag.deleteMany({ where: { promptId: id } });
        if (tags.length > 0) {
          await tx.promptTag.createMany({
            data: tags.map((t) => ({ promptId: id, tag: t })),
          });
        }
      }
    });

    // Re-fetch with updated tags
    const refreshed = await prisma.prompt.findUnique({
      where: { id },
      include: { tags: true, versions: { orderBy: { version: "desc" } } },
    });

    return NextResponse.json({ prompt: refreshed });
  } catch (err) {
    console.error("[PUT /api/prompts/[id]]", err);
    return NextResponse.json(
      { error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id || id.length < 1) {
      return NextResponse.json(
        { error: "Invalid prompt ID", code: "INVALID_ID" },
        { status: 400 }
      );
    }

    const existing = await prisma.prompt.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: "Not found", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    await prisma.prompt.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[DELETE /api/prompts/[id]]", err);
    return NextResponse.json(
      { error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
