import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { knowledgeSearchSchema, formatZodError } from "@/lib/validation/schemas";
import { embedOne, cosineSimilarity, EMBED_MODEL } from "@/lib/ai/embeddings";

export async function POST(req: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body", code: "INVALID_JSON" }, { status: 400 });
    }

    const parsed = knowledgeSearchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: formatZodError(parsed.error), code: "VALIDATION_ERROR" },
        { status: 400 }
      );
    }

    const { query, topK } = parsed.data;

    let queryVec: number[];
    try {
      queryVec = await embedOne(query);
    } catch (err) {
      return NextResponse.json(
        {
          error: `Embedding failed — is Ollama running with ${EMBED_MODEL}? ${err instanceof Error ? err.message : ""}`,
          code: "EMBED_FAILED",
        },
        { status: 502 }
      );
    }

    // Brute-force cosine over all chunks. Fine for a personal-scale knowledge base;
    // swap for a vector index (sqlite-vec / libsql vector) if this grows large.
    const chunks = await prisma.knowledgeChunk.findMany({
      include: { doc: { select: { title: true } } },
    });

    const scored = chunks
      .map((c) => {
        let vec: number[] = [];
        try { vec = JSON.parse(c.embedding); } catch { /* skip */ }
        return {
          id: c.id,
          docId: c.docId,
          docTitle: c.doc.title,
          content: c.content,
          score: cosineSimilarity(queryVec, vec),
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return NextResponse.json({ results: scored });
  } catch (err) {
    console.error("[POST /api/knowledge/search]", err);
    return NextResponse.json({ error: "Internal server error", code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
