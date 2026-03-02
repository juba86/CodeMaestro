import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { z } from "zod";
import * as yaml from "js-yaml";

const importSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().default(""),
  content: z.string().min(1),
  structured: z.record(z.string(), z.unknown()).optional().default({}),
  tags: z.array(z.string()).optional().default([]),
});

export async function POST(req: NextRequest) {
  try {
    const text = await req.text();
    let data: unknown;

    // Try JSON first, then YAML
    try {
      data = JSON.parse(text);
    } catch {
      data = yaml.load(text);
    }

    const parsed = importSchema.parse(data);

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
    const msg = err instanceof Error ? err.message : "Invalid import data";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
