import type { PromptStructured, ProviderName, PromptTechnique } from "@/lib/ai/types";
import { techniques } from "./techniques";
import { getBaseUrl } from "@/lib/ai/client-keys";

const techniqueGuidance: Record<PromptTechnique, string> = {
  "chain-of-thought": "Use classic Chain-of-Thought: guide the model through intermediate reasoning steps with examples showing step-by-step thinking.",
  "zero-shot-cot": "Use Zero-Shot CoT: append 'Let\\'s think step by step' at the end of the task. No examples needed.",
  "few-shot-cot": "Use Few-Shot CoT: provide 3-5 worked examples with detailed reasoning chains before the task.",
  "self-consistency": "Use Self-Consistency: instruct the model to generate 3+ independent reasoning paths and select the majority answer.",
  "tree-of-thoughts": "Use Tree of Thoughts: instruct the model to explore multiple reasoning branches, evaluate each branch, and backtrack from dead ends before selecting the best path.",
  "react": "Use ReAct pattern: structure the prompt as interleaved Thought/Action/Observation cycles for tool-using agents.",
  "self-refine": "Use Self-Refine: instruct the model to generate an initial response, critique it, then improve iteratively (2-3 cycles).",
  "role-prompting": "Use Role Prompting: assign a specific expert persona at the start to focus domain knowledge and tone.",
  "structured-output": "Use Structured Output: specify an exact output schema (JSON/XML) and instruct the model to conform to it strictly.",
  "meta-prompting": "Use Meta-Prompting: instruct the model to first design an optimal prompt strategy, then execute that strategy.",
  "constitutional": "Use Constitutional AI: define explicit principles/rules and instruct the model to critique its own output against each principle.",
  "step-back": "Use Step-Back Prompting: first ask the model to consider the abstract principles/theory, then apply them to the specific problem.",
  "analogical": "Use Analogical Reasoning: instruct the model to generate 2-3 analogous solved problems before tackling the target problem.",
  "decomposition": "Use Decomposition: instruct the model to break the task into independent sub-tasks, solve each, then combine results.",
};

const BASE_SYSTEM_PROMPT = `You are an expert prompt engineer. Given the user's project details, generate a structured prompt using XML tags.

Your output must be valid, parseable XML using these tags:
- <instructions>: Clear task definition
- <context>: Background information
- <constraints>: Rules and limitations
- <target-audience>: Who the output is for
- <output-format>: Expected format
- <examples>: With <example> children containing <input>, <thinking>, and <answer>
- <task>: The specific task to execute

If swarm/multi-agent config is provided, include:
- <swarm-config> with topology, coordination, and memory attributes, containing <agents> with <agent> elements

Make the prompt comprehensive, specific, and optimized.
Include at least one detailed example with step-by-step thinking.
Output ONLY the XML, no explanations.`;

function buildSystemPrompt(technique?: PromptTechnique): string {
  if (!technique) return BASE_SYSTEM_PROMPT;

  const guidance = techniqueGuidance[technique];
  const info = techniques.find((t) => t.id === technique);

  return `${BASE_SYSTEM_PROMPT}

IMPORTANT: The user has selected the "${info?.name || technique}" technique.
${guidance}
Structure the entire prompt to leverage this technique effectively. Adapt the examples, instructions, and task sections accordingly.`;
}

export async function generateCoTPrompt(
  data: PromptStructured,
  provider: ProviderName,
  model: string,
  apiKey?: string
): Promise<PromptStructured | null> {
  const userMessage = buildUserMessage(data);
  const systemPrompt = buildSystemPrompt(data.technique);

  const res = await fetch("/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: userMessage }],
      systemPrompt,
      provider,
      model,
      apiKey,
      // Needed by the configurable (custom) OpenAI-compatible endpoint.
      baseUrl: getBaseUrl(provider),
    }),
  });

  if (!res.ok) {
    let msg = "AI generation failed";
    try {
      const e = await res.json();
      if (e?.error) msg = e.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }

  const { content } = await res.json();

  // Parse the XML response back into structured data
  const { parseXml } = await import("./xml-parser");
  return parseXml(content);
}

function buildUserMessage(data: PromptStructured): string {
  const parts: string[] = [];
  parts.push(`Goal/Instructions: ${data.instructions}`);
  if (data.context) parts.push(`Context: ${data.context}`);
  if (data.constraints) parts.push(`Constraints: ${data.constraints}`);
  if (data.targetAudience) parts.push(`Target Audience: ${data.targetAudience}`);
  if (data.outputFormat) parts.push(`Output Format: ${data.outputFormat}`);
  if (data.task) parts.push(`Task: ${data.task}`);
  if (data.swarmConfig) {
    const sc = data.swarmConfig;
    parts.push(
      `Swarm Config: topology=${sc.topology}, coordination=${sc.coordinationStrategy}, memory=${sc.memoryScope}, agents=[${sc.agentRoles.map((r) => `${r.type}:${r.name}`).join(", ")}]`
    );
  }
  if (data.technique) {
    const info = techniques.find((t) => t.id === data.technique);
    parts.push(`Prompting Technique: ${info?.name || data.technique} — ${info?.description || ""}`);
  }
  return parts.join("\n\n");
}
