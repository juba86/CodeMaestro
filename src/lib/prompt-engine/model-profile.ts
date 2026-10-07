/**
 * Classifies the model a prompt will run on, so the generator, refinement and
 * linter can apply the rules that model needs. Pure: no network, no storage.
 *
 * Sources: Claude migration guides and refusal docs (platform.claude.com).
 * Unknown Claude ids are treated as current models, because the modern rules
 * are safe on older models while legacy patterns can fail on current ones.
 */

export type ModelFamily = "claude5" | "claude4" | "other";
export type ClaudeLine = "opus" | "sonnet" | "haiku" | "fable" | "mythos";

export interface ModelProfile {
  /** "claude4" covers Claude 4.x and older Claude generations. */
  family: ModelFamily;
  /** Claude model line, when known. */
  line?: ClaudeLine;
  /** major * 100 + minor (Claude 5.5 → 505), when known. */
  version?: number;
  /** Human-readable name for prompts and hints, e.g. "Claude Opus 5.5". */
  label: string;
  /** Built-in reasoning steered by effort, not by "think step by step" text. */
  adaptiveThinking: boolean;
  /** A trailing assistant message (prefill) returns HTTP 400 (Claude 4.6+). */
  rejectsPrefill: boolean;
  /** Non-default temperature / top_p / top_k return HTTP 400 (Claude 4.7+). */
  rejectsSampling: boolean;
  /** Asking for visible reasoning (thinking/scratchpad sections, reasoning
   *  fields) can end in a billed reasoning_extraction refusal. */
  reasoningExtractionRisk: boolean;
  /** Follows instructions literally: lean prompts with goals, constraints and
   *  reasons beat long step scripts and emphasis. */
  prefersConcise: boolean;
}

// The id may carry a suffix: a date, "@…" (Vertex), ":0" (Bedrock) or "[1m]".
const CLAUDE_RE = /claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:[.-](\d{1,2}))?(?=$|[-@:._/\s[])/i;
// Claude 3-era naming: claude-3-5-sonnet-…, claude-3.5-sonnet
const LEGACY_CLAUDE_RE = /claude-(\d)(?:[.-](\d))?-(opus|sonnet|haiku)/i;
// Aliases the Claude CLI accepts in place of a full id.
const CLAUDE_ALIASES: readonly string[] = ["opus", "sonnet", "haiku", "fable", "mythos"];
// Well-known non-Claude models with built-in reasoning (heuristic list).
const REASONING_MODEL_RE =
  /(^|\/)(o\d(-|$)|gpt-5|gpt-oss|deepseek-(reasoner|r1)|gemini-(2\.5|[3-9])|qwq|sonar-reasoning)|thinking/i;

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function claudeProfile(line: ClaudeLine | undefined, version: number | undefined): ModelProfile {
  // Unknown version on a Claude provider: assume a current model.
  const v = version ?? 505;
  const family: ModelFamily = v >= 500 ? "claude5" : "claude4";
  const label = line
    ? `Claude ${cap(line)}${version ? ` ${Math.floor(version / 100)}${version % 100 ? `.${version % 100}` : ""}` : ""}`
    : "Claude";
  return {
    family,
    line,
    version,
    label,
    adaptiveThinking: v >= 406,
    rejectsPrefill: v >= 406,
    rejectsSampling: v >= 407,
    reasoningExtractionRisk: family === "claude5" && line !== "haiku",
    prefersConcise: family === "claude5",
  };
}

/**
 * Profile for a provider id (see catalog.ts) and model id. Claude ids are
 * recognised under any provider (OpenRouter "anthropic/claude-…", Bedrock
 * "anthropic.claude-…"), so routing through a gateway keeps the right rules.
 */
export function getModelProfile(provider?: string | null, model?: string | null): ModelProfile {
  const id = (model || "").trim();
  const m = CLAUDE_RE.exec(id);
  if (m) {
    return claudeProfile(m[1].toLowerCase() as ClaudeLine, Number(m[2]) * 100 + Number(m[3] || 0));
  }
  const legacy = LEGACY_CLAUDE_RE.exec(id);
  if (legacy) {
    return claudeProfile(legacy[3].toLowerCase() as ClaudeLine, Number(legacy[1]) * 100 + Number(legacy[2] || 0));
  }
  const lower = id.toLowerCase();
  if (provider === "claude" || lower.startsWith("claude")) {
    const alias = CLAUDE_ALIASES.find((a) => lower === a || lower.startsWith(`${a}[`));
    return claudeProfile(alias as ClaudeLine | undefined, undefined);
  }
  return {
    family: "other",
    label: id || provider || "unknown model",
    adaptiveThinking: REASONING_MODEL_RE.test(lower),
    rejectsPrefill: false,
    rejectsSampling: false,
    reasoningExtractionRisk: false,
    prefersConcise: false,
  };
}
