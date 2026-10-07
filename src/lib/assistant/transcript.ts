import { prisma } from "@/lib/db/client";
import { monotonicNow } from "./run-hub";
import type { NormalizedEvent } from "./runner";

export interface TranscriptRow {
  role: string;
  content: string;
  meta?: string;
}

/**
 * Persists assistant transcript rows progressively and in order while a run is
 * streaming (instead of one batch at the end). Text is buffered into one
 * "assistant" row per segment and flushed whenever a tool call starts, so the
 * stored transcript interleaves text and tool calls exactly as they happened —
 * and a crash or restart mid-run loses at most the current text segment.
 *
 * Writes are serialized through a promise chain and stamped with a strictly
 * increasing timestamp, so `ORDER BY createdAt` reproduces the stream order.
 */
export class TranscriptWriter {
  private chain: Promise<unknown> = Promise.resolve();
  private text = "";
  private textMeta = "{}";

  constructor(private readonly sessionId: string) {}

  /** Queues a row for insertion (in call order). */
  add(row: TranscriptRow): void {
    const createdAt = new Date(monotonicNow());
    const data = { sessionId: this.sessionId, role: row.role, content: row.content, meta: row.meta ?? "{}", createdAt };
    this.chain = this.chain
      .then(() => prisma.assistantMessage.create({ data }))
      .catch((err) => console.error("[transcript] write failed", err));
  }

  /** Appends streamed assistant text to the current segment. */
  appendText(content: string, meta = "{}"): void {
    if (this.text && meta !== this.textMeta) this.flushText();
    this.textMeta = meta;
    this.text += content;
  }

  /** Writes the buffered text segment (if any) as one assistant row. */
  flushText(): void {
    const t = this.text.trim();
    if (t) this.add({ role: "assistant", content: t, meta: this.textMeta });
    this.text = "";
    this.textMeta = "{}";
  }

  /** Maps a runner event onto transcript rows. */
  record(e: NormalizedEvent): void {
    if (e.type === "text" && e.content) {
      this.appendText(e.content);
    } else if (e.type === "tool_use") {
      this.flushText();
      this.add({
        role: "tool_use",
        content: e.name || "tool",
        meta: JSON.stringify({ name: e.name, input: e.input, toolUseId: e.toolUseId }),
      });
    } else if (e.type === "tool_result") {
      this.add({
        role: "tool_result",
        content: (e.content || "").slice(0, 8000),
        meta: JSON.stringify({ toolUseId: e.toolUseId, isError: e.isError }),
      });
    } else if (e.type === "error" && e.content) {
      this.flushText();
      this.add({ role: "error", content: e.content.slice(0, 4000) });
    } else if (e.type === "knowledge" && e.sources?.length) {
      this.add({
        role: "knowledge",
        content: `${e.sources.length} Quelle(n) aus der Wissensbasis`,
        meta: JSON.stringify({ sources: e.sources }),
      });
    }
  }

  /** Flushes pending text and waits until every queued row is written. */
  async close(): Promise<void> {
    this.flushText();
    await this.chain;
  }
}
