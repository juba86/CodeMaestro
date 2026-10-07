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
 * Only chunks embedded with the CURRENT embedding model are compared: vectors
 * from different models live in different spaces, so mixing them yields
 * meaningless scores. Chunks of another model (after OLLAMA_EMBED_MODEL
 * changed) are ignored until their document is re-indexed. The index has
 * always recorded the model, so model "" has no legitimate source and is
 * excluded too.
 *
 * Throws only on embedding failure (so callers that want to surface "is Ollama
 * running?" can). Returns an empty array — without calling Ollama — when there
 * is nothing to search.
 */
export async function retrieveChunks(
  query: string,
  { topK = 5, minScore = 0 }: RetrieveOptions = {}
): Promise<RetrievedChunk[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  // Cheap existence check first: every assistant/Telegram turn calls this, and
  // an embedding is a full Ollama round trip even when the KB is empty.
  const where = { model: { in: modelAliases(EMBED_MODEL) } };
  if ((await prisma.knowledgeChunk.count({ where })) === 0) return [];

  const queryVec = await embedOne(trimmed);

  const chunks = await prisma.knowledgeChunk.findMany({
    where,
    select: { id: true, docId: true, content: true, embedding: true, doc: { select: { title: true } } },
  });

  const scored: RetrievedChunk[] = [];
  for (const c of chunks) {
    let vec: unknown;
    try { vec = JSON.parse(c.embedding); } catch { continue; /* skip malformed */ }
    // Same model ⇒ same dimension; anything else is corrupt, not comparable.
    if (!Array.isArray(vec) || vec.length !== queryVec.length) continue;
    const score = cosineSimilarity(queryVec, vec as number[]);
    if (score < minScore) continue;
    scored.push({ id: c.id, docId: c.docId, docTitle: c.doc.title, content: c.content, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}

/** Ollama treats "name" and "name:latest" as the same model. */
function modelAliases(model: string): string[] {
  if (model.endsWith(":latest")) return [model, model.slice(0, -":latest".length)];
  return model.includes(":") ? [model] : [model, `${model}:latest`];
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
