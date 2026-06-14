import type { PromptStructured, PromptExample, SwarmConfig, SwarmAgentRole, PromptTechnique } from "@/lib/ai/types";
import { techniques } from "./techniques";
import { uid } from "@/lib/uid";

/**
 * Lightweight regex-based XML parser for prompt XML format.
 *
 * Limitations:
 * - Uses regex, not a full XML parser — nested same-name tags may not parse correctly
 * - Attributes are only extracted from swarm-config tags
 * - CDATA sections are not supported
 *
 * This is sufficient for the PromptBuilder XML schema where tags are well-structured.
 */

function extractTag(xml: string, tagName: string): string {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, "i");
  const match = xml.match(regex);
  return match ? match[1].trim() : "";
}

function extractAttr(tag: string, attr: string): string {
  const regex = new RegExp(`${attr}="([^"]*)"`, "i");
  const match = tag.match(regex);
  return match ? match[1] : "";
}

function unescapeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/^\s{2}/gm, ""); // remove leading indent
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

  const examples: PromptExample[] = [];
  const examplesBlock = extractTag(xml, "examples");
  if (examplesBlock) {
    const exampleMatches = examplesBlock.match(/<example>[\s\S]*?<\/example>/gi) || [];
    for (const ex of exampleMatches) {
      examples.push({
        id: uid(),
        input: unescapeXml(extractTag(ex, "input")),
        thinking: unescapeXml(extractTag(ex, "thinking")),
        answer: unescapeXml(extractTag(ex, "answer")),
      });
    }
  }

  let swarmConfig: SwarmConfig | undefined;
  const swarmMatch = xml.match(/<swarm-config[^>]*>[\s\S]*?<\/swarm-config>/i);
  if (swarmMatch) {
    const swarmTag = swarmMatch[0];
    const agentMatches = swarmTag.match(/<agent[^>]*>[^<]*<\/agent>/gi) || [];
    const agentRoles: SwarmAgentRole[] = agentMatches.map((a) => ({
      type: (extractAttr(a, "type") || "custom") as SwarmAgentRole["type"],
      name: extractAttr(a, "name") || "Agent",
      description: a.replace(/<[^>]+>/g, "").trim(),
    }));

    swarmConfig = {
      topology: (extractAttr(swarmTag, "topology") || "hierarchical") as SwarmConfig["topology"],
      coordinationStrategy: (extractAttr(swarmTag, "coordination") || "majority") as SwarmConfig["coordinationStrategy"],
      memoryScope: (extractAttr(swarmTag, "memory") || "project") as SwarmConfig["memoryScope"],
      agentCount: agentRoles.length || 4,
      agentRoles,
    };
  }

  // Parse technique tag — match by name or id
  let technique: PromptTechnique | undefined;
  const techniqueRaw = extractTag(xml, "technique");
  if (techniqueRaw) {
    const found = techniques.find(
      (t) =>
        techniqueRaw.toLowerCase().includes(t.id) ||
        techniqueRaw.toLowerCase().includes(t.name.toLowerCase())
    );
    if (found) technique = found.id;
  }

  return {
    instructions: unescapeXml(extractTag(xml, "instructions")),
    context: unescapeXml(extractTag(xml, "context")),
    constraints: unescapeXml(extractTag(xml, "constraints")),
    targetAudience: unescapeXml(extractTag(xml, "target-audience")),
    outputFormat: unescapeXml(extractTag(xml, "output-format")),
    examples,
    task: unescapeXml(extractTag(xml, "task")),
    swarmConfig,
    technique,
  };
}
