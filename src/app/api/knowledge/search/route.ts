import { NextRequest, NextResponse } from "next/server";
import { knowledgeSearchSchema, formatZodError } from "@/lib/validation/schemas";
import { retrieveChunks, EMBED_MODEL } from "@/lib/knowledge/retrieve";

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

    let scored;
    try {
      // Shared retrieval path — identical to what the Code Assistant and the
      // Telegram bridge use (see src/lib/knowledge/retrieve.ts).
      scored = await retrieveChunks(query, { topK });
    } catch (err) {
      return NextResponse.json(
        {
          error: `Embedding failed — is Ollama running with ${EMBED_MODEL}? ${err instanceof Error ? err.message : ""}`,
          code: "EMBED_FAILED",
        },
        { status: 502 }
      );
    }

    return NextResponse.json({ results: scored });
  } catch (err) {
    console.error("[POST /api/knowledge/search]", err);
    return NextResponse.json({ error: "Internal server error", code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
