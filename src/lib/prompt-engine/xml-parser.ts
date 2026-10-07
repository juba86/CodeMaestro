import type { PromptStructured, PromptExample, SwarmConfig, SwarmAgentRole, PromptTechnique } from "@/lib/ai/types";
import { techniques } from "./techniques";
import { XML_INDENT } from "./xml-builder";
import { uid } from "@/lib/uid";

/**
 * Lightweight regex-based XML parser for prompt XML format.
 *
 * Limitations:
 * - Uses regex, not a full XML parser — nested same-name tags may not parse correctly
 * - Attributes are only extracted from swarm-config tags
 * - CDATA sections are not supported
 *
 * This is sufficient for the CodeMaestro XML schema where tags are well-structured.
 *
 * Round trip: parseXml(buildXml(x)) reproduces x field by field — including
 * multi-line values, user indentation and & < > " — except for example ids
 * (regenerated) and whitespace at the very edges of a value (surrounding
 * spaces of single-line values, leading/trailing blank lines), which is
 * normalised away. Looser hand-written or AI-generated XML parses too.
 */

// Indentation depth (in XML_INDENT units) of a value's lines as emitted by
// buildXml: top-level tags sit at depth 0 so their content is at 1; example
// fields sit at depth 2 (<examples> > <example> > <input>) so content is at 3.
// Only used when the tag's own indentation can't be read (see extractRaw).
const TOP_LEVEL_DEPTH = 1;
const EXAMPLE_FIELD_DEPTH = 3;

const EXAMPLES_RE = /<examples(?:\s[^>]*)?>([\s\S]*?)<\/examples\s*>/i;
const SWARM_RE = /<swarm[-_]config(?:\s[^>]*)?>[\s\S]*?<\/swarm[-_]config\s*>/i;

// Plain-text fields and their tags.
const FIELD_TAGS = [
  ["instructions", "instructions"],
  ["context", "context"],
  ["constraints", "constraints"],
  ["targetAudience", "target-audience"],
  ["outputFormat", "output-format"],
  ["task", "task"],
] as const;

/**
 * Regex source matching a tag name; models often write hyphenated names with
 * underscores (<output_format>), so both spellings are accepted.
 */
export function tagPattern(tagName: string): string {
  return tagName.replace(/-/g, "[-_]");
}

/** Top-level tags of the prompt schema (e.g. to recognise a prompt in free text). */
export const PROMPT_TAGS: readonly string[] = [
  ...FIELD_TAGS.map(([, tagName]) => tagName),
  "examples",
  "technique",
  "swarm-config",
];

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/**
 * Decodes XML entities in a single pass, so an escaped literal such as
 * "&amp;lt;" correctly becomes "&lt;" (a chained replace would yield "<").
 */
function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (m, ent: string) => {
    if (ent[0] !== "#") return ENTITIES[ent];
    const code = ent[1] === "x" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
    return code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}

function leadingWhitespace(line: string): number {
  let i = 0;
  while (line[i] === " " || line[i] === "\t") i++;
  return i;
}

/**
 * Turns the raw text between an open and a close tag back into the value.
 * Multi-line values are emitted by the builder on their own lines, indented
 * one XML_INDENT deeper than the tag; exactly that indentation (`maxStrip`
 * characters) is removed — less when looser XML is indented less — so the
 * user's own indentation survives any number of round trips.
 */
function cleanContent(raw: string, maxStrip: number): string {
  if (!raw.includes("\n")) return unescapeXml(raw.trim());

  const lines = raw.split("\n");
  // Text sharing a line with the open/close tag carries no indentation.
  lines[0] = lines[0].trimStart();
  lines[lines.length - 1] = lines[lines.length - 1].trimEnd();
  const firstOnTagLine = lines[0] !== "";
  while (lines.length > 0 && !lines[0].trim()) lines.shift();
  while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop();
  if (lines.length === 0) return "";

  const indented = firstOnTagLine ? lines.slice(1) : lines;
  const nonBlank = indented.filter((l) => l.trim());
  const strip = Math.min(maxStrip, ...nonBlank.map(leadingWhitespace));
  const out = lines.map((l, i) =>
    firstOnTagLine && i === 0 ? l : l.slice(Math.min(strip, leadingWhitespace(l)))
  );
  return unescapeXml(out.join("\n"));
}

interface RawTag {
  content: string;
  // Indentation of the open tag's line, or null when the tag shares its line
  // with other text (or that line starts outside `xml`).
  tagIndent: number | null;
}

/** `atLineStart`: whether `xml` itself begins at the start of a line. */
function extractRaw(xml: string, tagName: string, atLineStart = true): RawTag | null {
  const name = tagPattern(tagName);
  const regex = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}\\s*>`, "i");
  const match = xml.match(regex);
  if (!match || match.index === undefined) return null;
  const lineStart = xml.lastIndexOf("\n", match.index - 1) + 1;
  const prefix = xml.slice(lineStart, match.index);
  const known = /^[ \t]*$/.test(prefix) && (lineStart > 0 || atLineStart);
  return { content: match[1], tagIndent: known ? prefix.length : null };
}

/**
 * Reads a plain-text field. Its content is expected one XML_INDENT deeper
 * than the tag itself, which also handles prompts nested in a wrapper such as
 * <prompt>; `depth` is the builder's layout, the fallback when the tag's
 * indentation is unknown.
 */
function extractField(xml: string, tagName: string, depth: number, atLineStart = true): string {
  const raw = extractRaw(xml, tagName, atLineStart);
  if (raw === null) return "";
  const maxStrip =
    raw.tagIndent !== null ? raw.tagIndent + XML_INDENT.length : XML_INDENT.length * depth;
  return cleanContent(raw.content, maxStrip);
}

/** Reads an attribute from a single opening tag (double or single quoted). */
function extractAttr(openTag: string, attr: string): string {
  const regex = new RegExp(`\\s${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i");
  const match = openTag.match(regex);
  return match ? unescapeXml(match[1] ?? match[2] ?? "") : "";
}

const TOPOLOGIES: readonly SwarmConfig["topology"][] = ["hierarchical", "mesh", "ring", "star"];
const STRATEGIES: readonly SwarmConfig["coordinationStrategy"][] = ["majority", "weighted", "byzantine"];
const MEMORY_SCOPES: readonly SwarmConfig["memoryScope"][] = ["project", "local", "user"];
const ROLE_TYPES: readonly SwarmAgentRole["type"][] = [
  "researcher", "coder", "analyst", "tester", "architect",
  "reviewer", "optimizer", "documenter", "custom",
];

function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  const v = value.trim().toLowerCase();
  return (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function parseSwarm(block: string): SwarmConfig {
  const open = block.match(/<swarm[-_]config(?:\s[^>]*)?>/i)?.[0] ?? "";
  const agentsOpen = block.match(/<agents(?:\s[^>]*)?>/i)?.[0] ?? "";
  const agentRoles: SwarmAgentRole[] = [
    ...block.matchAll(/<agent(\s[^>]*)?>([\s\S]*?)<\/agent\s*>/gi),
  ].map((m) => ({
    type: oneOf(extractAttr(m[1] ?? "", "type"), ROLE_TYPES, "custom"),
    name: extractAttr(m[1] ?? "", "name") || "Agent",
    description: unescapeXml(m[2].trim()),
  }));
  const count = parseInt(extractAttr(agentsOpen, "count"), 10);

  return {
    topology: oneOf(extractAttr(open, "topology"), TOPOLOGIES, "hierarchical"),
    coordinationStrategy: oneOf(extractAttr(open, "coordination"), STRATEGIES, "majority"),
    memoryScope: oneOf(extractAttr(open, "memory"), MEMORY_SCOPES, "project"),
    agentCount: count > 0 ? Math.max(count, agentRoles.length) : agentRoles.length || 4,
    agentRoles,
  };
}

function parseTechnique(text: string): PromptTechnique | undefined {
  const lower = text.toLowerCase();
  // Builder format is "<name> — <description>": match the head exactly first,
  // then fall back to a substring search for free-form (AI) text.
  const head = lower.split(" — ")[0].trim();
  const found =
    techniques.find((t) => t.id === head || t.name.toLowerCase() === head) ??
    techniques.find((t) => lower.includes(t.id) || lower.includes(t.name.toLowerCase()));
  return found?.id;
}

// Top-level fields are read with the nested blocks removed, so e.g. a <task>
// inside an (AI-written) example can't shadow the real one.
function withoutNestedBlocks(xml: string): string {
  return xml.replace(EXAMPLES_RE, "").replace(SWARM_RE, "");
}

export function parseXml(xml: string): PromptStructured {
  // Fallback: return empty structure if input is empty/invalid
  if (!xml || typeof xml !== "string") {
    return {
      instructions: "",
      context: "",
      constraints: "",
      examples: [],
      task: "",
      targetAudience: "",
      outputFormat: "",
    };
  }
  // Pasted Windows text: CR would survive into every line of a value.
  xml = xml.replace(/\r\n?/g, "\n");

  const examples: PromptExample[] = [];
  const examplesBlock = xml.match(EXAMPLES_RE)?.[1];
  if (examplesBlock) {
    for (const m of examplesBlock.matchAll(/<example(?:\s[^>]*)?>([\s\S]*?)<\/example\s*>/gi)) {
      // `ex` starts mid-line, right after the <example> tag.
      const ex = m[1];
      examples.push({
        id: uid(),
        input: extractField(ex, "input", EXAMPLE_FIELD_DEPTH, false),
        thinking: extractField(ex, "thinking", EXAMPLE_FIELD_DEPTH, false),
        answer: extractField(ex, "answer", EXAMPLE_FIELD_DEPTH, false),
      });
    }
  }

  const swarmBlock = xml.match(SWARM_RE)?.[0];
  const swarmConfig = swarmBlock ? parseSwarm(swarmBlock) : undefined;

  const top = withoutNestedBlocks(xml);
  const techniqueRaw = extractField(top, "technique", TOP_LEVEL_DEPTH);

  return {
    instructions: extractField(top, "instructions", TOP_LEVEL_DEPTH),
    context: extractField(top, "context", TOP_LEVEL_DEPTH),
    constraints: extractField(top, "constraints", TOP_LEVEL_DEPTH),
    targetAudience: extractField(top, "target-audience", TOP_LEVEL_DEPTH),
    outputFormat: extractField(top, "output-format", TOP_LEVEL_DEPTH),
    examples,
    task: extractField(top, "task", TOP_LEVEL_DEPTH),
    swarmConfig,
    technique: techniqueRaw ? parseTechnique(techniqueRaw) : undefined,
  };
}

/**
 * Like parseXml, but returns only the sections whose tags actually occur in
 * `xml` (and a technique/swarm config only when one was recognised). Merging
 * the result into an existing prompt replaces what the AI rewrote without
 * wiping what it left out — e.g. the selected technique, which models rarely
 * echo back.
 */
export function parseXmlPartial(xml: string): Partial<PromptStructured> {
  if (!xml || typeof xml !== "string") return {};
  const full = parseXml(xml);
  const top = withoutNestedBlocks(xml);
  const out: Partial<PromptStructured> = {};
  for (const [key, tagName] of FIELD_TAGS) {
    if (extractRaw(top, tagName) !== null) out[key] = full[key];
  }
  // An <examples> block without parseable <example> items (e.g. free text)
  // must not wipe the existing examples; only an empty block clears them.
  const examplesBlock = xml.match(EXAMPLES_RE)?.[1];
  if (examplesBlock !== undefined && (full.examples.length > 0 || !examplesBlock.trim())) {
    out.examples = full.examples;
  }
  if (full.technique) out.technique = full.technique;
  if (full.swarmConfig) out.swarmConfig = full.swarmConfig;
  return out;
}
