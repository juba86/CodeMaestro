import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { createKnowledgeDocSchema, formatZodError } from "@/lib/validation/schemas";
import { embedTexts, chunkText, EMBED_MODEL } from "@/lib/ai/embeddings";

export async function GET() {
  const docs = await prisma.knowledgeDoc.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { chunks: true } } },
  });
  return NextResponse.json({
    docs: docs.map((d) => ({
      id: d.id,
      title: d.title,
      source: d.source,
      createdAt: d.createdAt,
      chunkCount: d._count.chunks,
    })),
  });
}

export async function POST(req: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body", code: "INVALID_JSON" }, { status: 400 });
    }

    const parsed = createKnowledgeDocSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: formatZodError(parsed.error), code: "VALIDATION_ERROR" },
        { status: 400 }
      );
    }

    const { title, source, content } = parsed.data;
    const chunks = chunkText(content);
    if (chunks.length === 0) {
      return NextResponse.json({ error: "No content to index", code: "EMPTY" }, { status: 400 });
    }

    let embeddings: number[][];
    try {
      embeddings = await embedTexts(chunks);
    } catch (err) {
      return NextResponse.json(
        {
          error: `Embedding failed — is Ollama running with ${EMBED_MODEL}? ${err instanceof Error ? err.message : ""}`,
          code: "EMBED_FAILED",
        },
        { status: 502 }
      );
    }

    const doc = await prisma.knowledgeDoc.create({
      data: {
        title,
        source,
        chunks: {
          create: chunks.map((c, i) => ({
            idx: i,
            content: c,
            embedding: JSON.stringify(embeddings[i]),
            model: EMBED_MODEL,
          })),
        },
      },
    });

    return NextResponse.json({ doc: { id: doc.id, title: doc.title, chunkCount: chunks.length } }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/knowledge]", err);
    return NextResponse.json({ error: "Internal server error", code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
