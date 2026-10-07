import type { PromptStructured } from "@/lib/ai/types";
import { techniques } from "./techniques";

// Indentation unit. The parser strips exactly this much per nesting level
// (see cleanContent in xml-parser.ts), so both stay in sync.
export const XML_INDENT = "  ";

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
 * goes on its own lines, each indented one level deeper than the tag.
 */
function tag(name: string, content: string, indent = 0): string {
  const pad = XML_INDENT.repeat(indent);
  if (!content.trim()) return "";
  if (content.includes("\n")) {
    return `${pad}<${name}>\n${content
      .split("\n")
      .map((l) => `${pad}${XML_INDENT}${l}`)
      .join("\n")}\n${pad}</${name}>`;
  }
  return `${pad}<${name}>${content}</${name}>`;
}

export function buildXml(data: PromptStructured): string {
  const parts: string[] = [];

  if (data.instructions) {
    parts.push(tag("instructions", escapeXml(data.instructions)));
  }

  if (data.context) {
    parts.push(tag("context", escapeXml(data.context)));
  }

  if (data.constraints) {
    parts.push(tag("constraints", escapeXml(data.constraints)));
  }

  if (data.targetAudience) {
    parts.push(tag("target-audience", escapeXml(data.targetAudience)));
  }

  if (data.outputFormat) {
    parts.push(tag("output-format", escapeXml(data.outputFormat)));
  }

  if (data.examples.length > 0) {
    const examplesContent = data.examples
      .map((ex) => {
        const inner: string[] = [];
        inner.push(tag("input", escapeXml(ex.input), 2));
        if (ex.thinking) {
          inner.push(tag("thinking", escapeXml(ex.thinking), 2));
        }
        inner.push(tag("answer", escapeXml(ex.answer), 2));
        return `${XML_INDENT}<example>\n${inner.filter(Boolean).join("\n")}\n${XML_INDENT}</example>`;
      })
      .join("\n\n");
    parts.push(`<examples>\n${examplesContent}\n</examples>`);
  }

  if (data.technique) {
    const info = techniques.find((t) => t.id === data.technique);
    if (info) {
      parts.push(tag("technique", escapeXml(`${info.name} — ${info.description}`)));
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
    parts.push(tag("task", escapeXml(data.task)));
  }

  return parts.filter(Boolean).join("\n\n");
}
