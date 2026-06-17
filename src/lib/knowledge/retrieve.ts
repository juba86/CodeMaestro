import { prisma } from "@/lib/db/client";
import { embedOne, cosineSimilarity, EMBED_MODEL } from "@/lib/ai/embeddings";

// ---------------------------------------------------------------------------
// Shared RAG retrieval layer.
//
// This is the SINGLE retrieval path used by every channel that needs knowledge:
// the /api/knowledge/search route (UI "Insert relevant context"), the Code
// Assistant message route, and the Telegram bridge. Keeping it here avoids
// duplicating the embed + cosine logic and guarantees all channels behave the
// same way (same model, same scoring, same graceful degradation).
// ---------------------------------------------------------------------------

export interface RetrievedChunk {
  id: string;
  docId: string;
  docTitle: string;
  content: string;
  score: number;
}

export interface RetrieveOptions {
  topK?: number;
  /** Drop chunks whose cosine score is below this (0 = keep all topK). */
  minScore?: number;
}

/**
 * Retrieves the most relevant knowledge-base chunks for a query.
 *
 * Brute-force cosine over all chunks — fine for a personal-scale knowledge base;
 * swap for a vector index (sqlite-vec / libsql vector) if this grows large.
 *
 * Throws only on embedding failure (so callers that want to surface "is Ollama
 * running?" can). Returns an empty array when the knowledge base is empty.
 */
export async function retrieveChunks(
  query: string,
  { topK = 5, minScore = 0 }: RetrieveOptions = {}
): Promise<RetrievedChunk[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const queryVec = await embedOne(trimmed);

  const chunks = await prisma.knowledgeChunk.findMany({
    include: { doc: { select: { title: true } } },
  });
  if (chunks.length === 0) return [];

  return chunks
    .map((c) => {
      let vec: number[] = [];
      try { vec = JSON.parse(c.embedding); } catch { /* skip malformed */ }
      return {
        id: c.id,
        docId: c.docId,
        docTitle: c.doc.title,
        content: c.content,
        score: cosineSimilarity(queryVec, vec),
      };
    })
    .filter((c) => c.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

export interface KnowledgeContext {
  /** Formatted context block ready to prepend to a prompt; "" when nothing relevant. */
  text: string;
  /** The chunks that were used (for telemetry / "sources" display). */
  chunks: RetrievedChunk[];
}

export interface BuildContextOptions extends RetrieveOptions {
  /** Hard cap on the injected context size, to keep prompts bounded. */
  maxChars?: number;
}

const EMPTY_CONTEXT: KnowledgeContext = { text: "", chunks: [] };

/**
 * Builds a bounded, model-readable context block from the knowledge base for a
 * query. Used by the assistant channels (Code Assistant + Telegram).
 *
 * Graceful by design: if Ollama is unreachable, the index is empty, or nothing
 * scores above `minScore`, it returns an EMPTY context ("") instead of throwing,
 * so the channel still answers (RAG augments, it never blocks).
 */
export async function buildKnowledgeContext(
  query: string,
  { topK = 5, minScore = 0.35, maxChars = 4000 }: BuildContextOptions = {}
): Promise<KnowledgeContext> {
  let chunks: RetrievedChunk[];
  try {
    chunks = await retrieveChunks(query, { topK, minScore });
  } catch {
    // Embedding/Ollama unreachable — degrade gracefully (answer without RAG).
    return EMPTY_CONTEXT;
  }
  if (chunks.length === 0) return EMPTY_CONTEXT;

  const used: RetrievedChunk[] = [];
  const parts: string[] = [];
  let budget = maxChars;
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const snippet = c.content.slice(0, budget);
    if (!snippet.trim()) break;
    parts.push(`[${i + 1}] (source: ${c.docTitle})\n${snippet}`);
    used.push(c);
    budget -= snippet.length;
    if (budget <= 0) break;
  }
  if (parts.length === 0) return EMPTY_CONTEXT;

  const text = [
    "<knowledge_base>",
    "Relevant context retrieved from the user's knowledge base. Use it when it",
    "helps answer the task; ignore it when it is not relevant. Do not invent",
    "sources beyond what is given here.",
    "",
    parts.join("\n\n"),
    "</knowledge_base>",
  ].join("\n");

  return { text, chunks: used };
}

/**
 * Prepends knowledge-base context to a user prompt for the assistant channels.
 * Returns the original prompt unchanged when RAG is disabled or nothing relevant
 * is found, so it is always safe to call.
 */
export async function augmentPromptWithKnowledge(
  prompt: string,
  opts: { enabled?: boolean } & BuildContextOptions = {}
): Promise<{ prompt: string; injected: boolean; sources: RetrievedChunk[] }> {
  const { enabled = true, ...ctxOpts } = opts;
  if (!enabled) return { prompt, injected: false, sources: [] };

  const ctx = await buildKnowledgeContext(prompt, ctxOpts);
  if (!ctx.text) return { prompt, injected: false, sources: [] };

  return {
    prompt: `${ctx.text}\n\n${prompt}`,
    injected: true,
    sources: ctx.chunks,
  };
}

export { EMBED_MODEL };
