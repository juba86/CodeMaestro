import { OLLAMA_BASE_URL } from "./ollama-provider";

// Local embedding model served by Ollama. bge-m3 is multilingual and a great
// default for a knowledge base; override via OLLAMA_EMBED_MODEL.
export const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "bge-m3:latest";

/**
 * Embeds one or more texts via the local Ollama daemon (/api/embed).
 * Returns one vector per input. Throws if Ollama is unreachable.
 */
export async function embedTexts(texts: string[], model = EMBED_MODEL): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ model, input: texts }),
  });
  if (!res.ok) {
    throw new Error(`Embedding failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { embeddings?: number[][] };
  if (!data.embeddings || data.embeddings.length !== texts.length) {
    throw new Error("Embedding response malformed");
  }
  return data.embeddings;
}

export async function embedOne(text: string, model = EMBED_MODEL): Promise<number[]> {
  const [v] = await embedTexts([text], model);
  return v;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Splits text into overlapping chunks by paragraph/sentence, targeting ~maxChars
 * per chunk. Keeps chunks semantically coherent for retrieval.
 */
export function chunkText(text: string, maxChars = 1200, overlap = 150): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  // Prefer splitting on blank lines, then single newlines, then sentences.
  const paragraphs = clean.split(/\n\s*\n/);
  const chunks: string[] = [];
  let current = "";

  const push = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };

  for (const para of paragraphs) {
    if (para.length > maxChars) {
      // Hard-split very long paragraphs by sentence.
      const sentences = para.split(/(?<=[.!?])\s+/);
      for (const s of sentences) {
        if ((current + " " + s).length > maxChars) push();
        current += (current ? " " : "") + s;
      }
      push();
    } else {
      if ((current + "\n\n" + para).length > maxChars) push();
      current += (current ? "\n\n" : "") + para;
    }
  }
  push();

  // Add overlap from the tail of the previous chunk for context continuity.
  if (overlap > 0 && chunks.length > 1) {
    for (let i = 1; i < chunks.length; i++) {
      const prevTail = chunks[i - 1].slice(-overlap);
      chunks[i] = `${prevTail} ${chunks[i]}`.trim();
    }
  }
  return chunks;
}
