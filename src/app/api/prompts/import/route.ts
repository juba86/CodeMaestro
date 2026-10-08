import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { z } from "zod";
import * as yaml from "js-yaml";
import { formatZodError, promptTagsSchema } from "@/lib/validation/schemas";

// Same limits as createPromptSchema; tags go through the shared schema so
// duplicates/empties are normalised before they can hit PromptTag's unique key.
const importSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional().default(""),
  content: z.string().min(1),
  structured: z.record(z.string(), z.unknown()).optional().default({}),
  tags: promptTagsSchema.optional().default([]),
});

export async function POST(req: NextRequest) {
  let data: unknown;
  try {
    const text = await req.text();
    // Try JSON first, then YAML
    try {
      data = JSON.parse(text);
    } catch {
      data = yaml.load(text);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid import data";
    return NextResponse.json({ error: msg, code: "INVALID_IMPORT" }, { status: 400 });
  }

  const result = importSchema.safeParse(data);
  if (!result.success) {
    return NextResponse.json(
      { error: formatZodError(result.error), code: "VALIDATION_ERROR" },
      { status: 400 }
    );
  }
  const parsed = result.data;

  try {
    const prompt = await prisma.prompt.create({
      data: {
        title: parsed.title,
        description: parsed.description,
        content: parsed.content,
        structured: JSON.stringify(parsed.structured),
        tags: parsed.tags.length > 0
          ? { create: parsed.tags.map((t) => ({ tag: t })) }
          : undefined,
        versions: {
          create: {
            version: 1,
            content: parsed.content,
            structured: JSON.stringify(parsed.structured),
            changelog: "Imported",
          },
        },
      },
      include: { tags: true },
    });

    return NextResponse.json({ prompt }, { status: 201 });
  } catch (err) {
    console.error("Prompt import failed:", err);
    return NextResponse.json({ error: "Import failed" }, { status: 500 });
  }
}
