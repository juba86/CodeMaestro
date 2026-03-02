import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { createPromptSchema, promptsPaginationSchema, formatZodError } from "@/lib/validation/schemas";

export async function GET(req: NextRequest) {
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = promptsPaginationSchema.safeParse(params);

  if (!parsed.success) {
    return NextResponse.json(
      { error: formatZodError(parsed.error), code: "VALIDATION_ERROR" },
      { status: 400 }
    );
  }

  const { q: search, tag, limit, offset } = parsed.data;

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

  const [prompts, total] = await Promise.all([
    prisma.prompt.findMany({
      where,
      include: { tags: true, _count: { select: { versions: true, testResults: true } } },
      orderBy: { updatedAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.prompt.count({ where }),
  ]);

  return NextResponse.json({ prompts, total, limit, offset });
}

export async function POST(req: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body", code: "INVALID_JSON" },
        { status: 400 }
      );
    }

    const result = createPromptSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: formatZodError(result.error), code: "VALIDATION_ERROR" },
        { status: 400 }
      );
    }

    const { title, description, content, structured, tags } = result.data;

    const prompt = await prisma.prompt.create({
      data: {
        title,
        description,
        content,
        structured,
        tags: tags.length > 0
          ? { create: tags.map((t) => ({ tag: t })) }
          : undefined,
        versions: {
          create: {
            version: 1,
            content,
            structured,
            changelog: "Initial version",
          },
        },
      },
      include: { tags: true, versions: true },
    });

    return NextResponse.json({ prompt }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/prompts]", err);
    return NextResponse.json(
      { error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
