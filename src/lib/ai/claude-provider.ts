import Anthropic from "@anthropic-ai/sdk";
import type { AIProvider, SendMessageParams, StreamChunk, ModelInfo } from "./types";
import { getStaticModels } from "./models";

export const DEFAULT_CLAUDE_MODEL = "claude-opus-5-5";
// Cheapest current model — validation only needs a successful round trip.
const VALIDATE_CLAUDE_MODEL = "claude-haiku-5-5";
// sendMessage keeps a moderate cap; streaming gets more room (no HTTP timeout risk).
const DEFAULT_MAX_TOKENS = 16000;
const DEFAULT_STREAM_MAX_TOKENS = 32000;
// Server-side refusal fallback ("default" = Anthropic routes by refusal category).
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

type Effort = NonNullable<SendMessageParams["effort"]>;
const EFFORT_ORDER: Effort[] = ["low", "medium", "high", "xhigh", "max"];

interface ClaudeVersion {
  line: string; // opus | sonnet | haiku | fable | mythos | "" (legacy claude-3 naming)
  v: number; // major * 100 + minor, e.g. 4.6 → 406
}

/** Parses ids like "claude-opus-4-6", "claude-fable-5-1-…" or "claude-3-5-sonnet-…". */
function parseClaudeModel(model: string): ClaudeVersion | null {
  const m = /^claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d{1,2}))?(?=-|$)/.exec(model);
  if (m) return { line: m[1], v: Number(m[2]) * 100 + Number(m[3] || 0) };
  const legacy = /^claude-(\d)(?:-(\d))?-/.exec(model);
  if (legacy) return { line: "", v: Number(legacy[1]) * 100 + Number(legacy[2] || 0) };
  return null;
}

// Claude 4.7+ / 5.x reject non-default temperature/top_p/top_k. Unknown ids are
// treated as current models (omit rather than risk a 400).
function acceptsSampling(model: string): boolean {
  const p = parseClaudeModel(model);
  return !!p && p.v < 407;
}

// Assistant prefill (conversation ending on an assistant turn) is rejected on 4.6+.
function acceptsPrefill(model: string): boolean {
  const p = parseClaudeModel(model);
  return !!p && p.v < 406;
}

/** Effort levels the model accepts ([] = no effort parameter at all). */
function effortLevels(model: string): Effort[] {
  const p = parseClaudeModel(model);
  if (!p || !p.line) return [];
  if (p.v >= 407 || (p.line === "haiku" && p.v >= 500)) return EFFORT_ORDER;
  if (p.line === "haiku") return []; // Haiku 4.5 and older
  if (p.v === 406) return ["low", "medium", "high", "max"]; // Opus/Sonnet 4.6
  if (p.line === "opus" && p.v === 405) return ["low", "medium", "high"];
  return [];
}

/** Highest supported level not above the requested one; undefined = don't send. */
function resolveEffort(model: string, requested?: Effort): Effort | undefined {
  if (!requested) return undefined;
  const allowed = effortLevels(model);
  for (let i = EFFORT_ORDER.indexOf(requested); i >= 0; i--) {
    if (allowed.includes(EFFORT_ORDER[i])) return EFFORT_ORDER[i];
  }
  return undefined;
}

function refusalError(details: { category: string | null; explanation: string | null } | null): string {
  const category = details?.category || "unbekannt";
  const why = details?.explanation ? ` ${details.explanation}` : "";
  return `Claude hat die Anfrage abgelehnt (refusal, Kategorie: ${category}).${why} Bitte Prompt umformulieren oder ein anderes Modell wählen.`;
}

/**
 * Fetches the live list of Claude models the given key can access via the
 * Models API (active + deprecated). Returns [] on any failure so the caller can
 * fall back to the static list.
 */
export async function fetchClaudeModels(apiKey: string): Promise<ModelInfo[]> {
  try {
    const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 15_000 });
    const out: ModelInfo[] = [];
    for await (const m of client.models.list({ limit: 100 })) {
      const name = m.display_name || m.id;
      out.push({
        id: m.id,
        name: m.lifecycle === "deprecated" ? `${name} (veraltet)` : name,
        provider: "claude",
        maxTokens: m.max_tokens ?? 32000,
      });
    }
    return out;
  } catch {
    return [];
  }
}

export class ClaudeProvider implements AIProvider {
  name = "claude" as const;
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  getModels(): ModelInfo[] {
    return getStaticModels("claude");
  }

  private buildRequest(params: SendMessageParams, defaultMaxTokens: number): Anthropic.Beta.Messages.MessageCreateParamsNonStreaming {
    const model = params.model || DEFAULT_CLAUDE_MODEL;

    // System-role chat messages join the top-level system prompt (the Messages API
    // has no "system" role in this position).
    const system = [params.systemPrompt, ...params.messages.filter((m) => m.role === "system").map((m) => m.content)]
      .filter((s): s is string => !!s && !!s.trim())
      .join("\n\n");

    const messages: Anthropic.Beta.Messages.BetaMessageParam[] = params.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
    // 4.6+ reject a trailing assistant turn (prefill) with a 400 — drop it so the
    // model answers the preceding user turn instead.
    if (!acceptsPrefill(model)) {
      while (messages.length > 1 && messages[messages.length - 1].role === "assistant") messages.pop();
    }

    const req: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming = {
      model,
      max_tokens: params.maxTokens || defaultMaxTokens,
      messages,
    };
    // Prompt caching (prefixes below the model's minimum silently don't cache):
    // - the system prompt gets its own breakpoint, so repeated runs of the same
    //   prompt (test cases, playground) re-read it at ~0.1x;
    // - multi-turn conversations (refinement chat) also auto-cache the history,
    //   which the next turn re-sends. A one-shot request skips that: its unique
    //   tail would pay the 1.25x write premium and never be read back.
    if (system) req.system = [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];
    if (messages.length > 1) req.cache_control = { type: "ephemeral" };
    // Claude's range is 0–1 (the shared chat schema allows OpenAI's 0–2).
    if (params.temperature != null && acceptsSampling(model)) {
      req.temperature = Math.min(1, Math.max(0, params.temperature));
    }
    const effort = resolveEffort(model, params.effort);
    if (effort) req.output_config = { effort };
    if (FALLBACK_MODELS.has(model)) {
      // On a safety-classifier decline, retry server-side on Anthropic's
      // recommended fallback model instead of returning the refusal.
      req.betas = [FALLBACK_BETA];
      req.fallbacks = "default";
    }
    return req;
  }

  async sendMessage(params: SendMessageParams): Promise<string> {
    // Streamed under the hood and collected via finalMessage(): long generations
    // never hit HTTP/SDK non-streaming timeouts, whatever maxTokens the caller sets.
    const message = await this.client.beta.messages
      .stream(this.buildRequest(params, DEFAULT_MAX_TOKENS))
      .finalMessage();
    if (message.stop_reason === "refusal") throw new Error(refusalError(message.stop_details));
    // Join every text block (a server-side fallback continues in a new block).
    return message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  }

  async *streamMessage(params: SendMessageParams): AsyncGenerator<StreamChunk> {
    const stream = this.client.beta.messages.stream(this.buildRequest(params, DEFAULT_STREAM_MAX_TOKENS));
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield { type: "text", content: event.delta.text };
      }
    }
    // Judge the refusal on the final snapshot (last message_delta wins): with a
    // server-side fallback the stream continues on the fallback model, and only a
    // refusal of the whole chain ends it with stop_reason "refusal". Text streamed
    // before such a refusal is partial and should be discarded by the caller.
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") yield { type: "error", content: refusalError(final.stop_details) };
    yield { type: "done", content: "" };
  }

  async validateCredentials(apiKey: string): Promise<boolean> {
    try {
      const client = new Anthropic({ apiKey, maxRetries: 1 });
      await client.messages.create({
        model: VALIDATE_CLAUDE_MODEL,
        max_tokens: 16,
        output_config: { effort: "low" },
        messages: [{ role: "user", content: "hi" }],
      });
      return true;
    } catch {
      return false;
    }
  }
}
