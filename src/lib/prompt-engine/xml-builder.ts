import type { PromptStructured } from "@/lib/ai/types";
import { techniques } from "./techniques";
import { EXAMPLE_METHOD_TAG, XML_INDENT, escapeContent } from "./xml-parser";

export { EXAMPLE_METHOD_TAG, XML_INDENT };

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Escapes a value for use inside a double-quoted XML attribute. */
function escapeAttr(s: string): string {
  return escapeXml(s).replace(/"/g, "&quot;");
}

/**
 * Renders `<name>content</name>` at the given nesting level. Multi-line content
 * goes on its own lines, each indented one level deeper than the tag (empty
 * lines stay empty rather than carrying trailing spaces).
 */
function tag(name: string, content: string, indent = 0): string {
  const pad = XML_INDENT.repeat(indent);
  if (!content.trim()) return "";
  if (content.includes("\n")) {
    return `${pad}<${name}>\n${content
      .split("\n")
      .map((l) => (l ? `${pad}${XML_INDENT}${l}` : ""))
      .join("\n")}\n${pad}</${name}>`;
  }
  return `${pad}<${name}>${content}</${name}>`;
}

/**
 * Renders the prompt. Long material goes first and the request last, as the
 * long-context guidance advises: context, instructions, constraints,
 * audience, output format, examples, technique, swarm config, task.
 *
 * Section text is escaped only where the parser would read it as markup (see
 * escapeContent), so tags from snippets such as <verification> or
 * <promise>DONE</promise> reach the model as written.
 */
export function buildXml(data: PromptStructured): string {
  const parts: string[] = [];

  if (data.context) {
    parts.push(tag("context", escapeContent(data.context)));
  }

  if (data.instructions) {
    parts.push(tag("instructions", escapeContent(data.instructions)));
  }

  if (data.constraints) {
    parts.push(tag("constraints", escapeContent(data.constraints)));
  }

  if (data.targetAudience) {
    parts.push(tag("target-audience", escapeContent(data.targetAudience)));
  }

  if (data.outputFormat) {
    parts.push(tag("output-format", escapeContent(data.outputFormat)));
  }

  if (data.examples.length > 0) {
    const examplesContent = data.examples
      .map((ex) => {
        const inner: string[] = [];
        inner.push(tag("input", escapeContent(ex.input, true), 2));
        // `thinking` keeps its name for saved prompts, but is rendered as the
        // docs' "method": a <thinking> section risks reasoning_extraction
        // refusals on Claude 5.x. The parser reads both tags.
        if (ex.thinking) {
          inner.push(tag(EXAMPLE_METHOD_TAG, escapeContent(ex.thinking, true), 2));
        }
        inner.push(tag("answer", escapeContent(ex.answer, true), 2));
        return `${XML_INDENT}<example>\n${inner.filter(Boolean).join("\n")}\n${XML_INDENT}</example>`;
      })
      .join("\n\n");
    parts.push(`<examples>\n${examplesContent}\n</examples>`);
  }

  // Only the name: it is metadata that lets the technique survive a round
  // trip, and the description is written for the user, not for the model.
  if (data.technique) {
    const info = techniques.find((t) => t.id === data.technique);
    if (info) {
      parts.push(tag("technique", escapeXml(info.name)));
    }
  }

  if (data.swarmConfig) {
    const sc = data.swarmConfig;
    const roles = sc.agentRoles
      .map(
        (r) =>
          `    <agent type="${escapeAttr(r.type)}" name="${escapeAttr(r.name)}">${escapeXml(r.description)}</agent>`
      )
      .join("\n");
    parts.push(
      `<swarm-config topology="${escapeAttr(sc.topology)}" coordination="${escapeAttr(sc.coordinationStrategy)}" memory="${escapeAttr(sc.memoryScope)}">\n  <agents count="${sc.agentCount}">\n${roles}\n  </agents>\n</swarm-config>`
    );
  }

  if (data.task) {
    parts.push(tag("task", escapeContent(data.task)));
  }

  return parts.filter(Boolean).join("\n\n");
}
