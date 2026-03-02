import type { PromptTechnique } from "@/lib/ai/types";

export interface TechniqueInfo {
  id: PromptTechnique;
  name: string;
  description: string;
  bestFor: string[];
  complexity: "low" | "medium" | "high";
  accuracyGain: string;
}

export const techniques: TechniqueInfo[] = [
  {
    id: "chain-of-thought",
    name: "Chain-of-Thought (CoT)",
    description: "Guide the model through intermediate reasoning steps. Include examples with step-by-step thinking.",
    bestFor: ["multi-step problems", "math", "logic", "code debugging"],
    complexity: "medium",
    accuracyGain: "~30% over direct prompting",
  },
  {
    id: "zero-shot-cot",
    name: "Zero-Shot CoT",
    description: "Append 'Think step by step' without providing examples. Minimal effort, broad applicability.",
    bestFor: ["quick reasoning", "exploratory analysis", "general reasoning"],
    complexity: "low",
    accuracyGain: "Moderate",
  },
  {
    id: "few-shot-cot",
    name: "Few-Shot CoT",
    description: "Provide 3-5 worked examples with reasoning chains. Most reliable CoT variant.",
    bestFor: ["domain-specific problems", "consistent output format", "complex reasoning"],
    complexity: "medium",
    accuracyGain: "~30% over zero-shot",
  },
  {
    id: "self-consistency",
    name: "Self-Consistency CoT",
    description: "Generate multiple reasoning paths and select by majority vote. Reduces errors.",
    bestFor: ["high-stakes decisions", "math/logic with single answer", "verification"],
    complexity: "medium",
    accuracyGain: "Significant over single CoT",
  },
  {
    id: "tree-of-thoughts",
    name: "Tree of Thoughts (ToT)",
    description: "Explore multiple reasoning branches, evaluate each, backtrack from dead ends.",
    bestFor: ["creative writing", "strategic planning", "puzzle solving", "architecture design"],
    complexity: "high",
    accuracyGain: "High for planning tasks",
  },
  {
    id: "react",
    name: "ReAct (Reasoning + Acting)",
    description: "Interleave reasoning with tool actions. The foundation of AI agent architectures.",
    bestFor: ["agentic coding", "research tasks", "multi-step tool use", "information gathering"],
    complexity: "medium",
    accuracyGain: "High for agentic tasks",
  },
  {
    id: "self-refine",
    name: "Self-Refine",
    description: "Generate, critique, and improve in iterative cycles. ~20% quality improvement.",
    bestFor: ["code generation", "writing", "complex reasoning", "quality-critical tasks"],
    complexity: "medium",
    accuracyGain: "~20% absolute improvement",
  },
  {
    id: "role-prompting",
    name: "Role / Persona Prompting",
    description: "Assign a specific expert identity to focus output style and depth.",
    bestFor: ["domain-specific tasks", "specific voice/perspective", "code review"],
    complexity: "low",
    accuracyGain: "Variable (concise roles work best)",
  },
  {
    id: "structured-output",
    name: "Structured Output",
    description: "Force responses into specific formats (JSON, XML, schemas) for programmatic consumption.",
    bestFor: ["API responses", "data extraction", "classification", "pipeline integration"],
    complexity: "low",
    accuracyGain: "N/A (format quality)",
  },
  {
    id: "meta-prompting",
    name: "Meta-Prompting",
    description: "Use the AI to generate and optimize prompts for other tasks.",
    bestFor: ["prompt library building", "prompt optimization", "cross-model adaptation"],
    complexity: "high",
    accuracyGain: "Compounds over time",
  },
  {
    id: "constitutional",
    name: "Constitutional AI / Self-Critique",
    description: "Define principles and have the AI critique its own output against them.",
    bestFor: ["content moderation", "policy compliance", "bias removal", "safety"],
    complexity: "medium",
    accuracyGain: "N/A (alignment quality)",
  },
  {
    id: "step-back",
    name: "Step-Back Prompting",
    description: "First consider abstract principles, then apply to the specific question. 7-27% gain.",
    bestFor: ["STEM problems", "knowledge-intensive QA", "first-principles thinking"],
    complexity: "medium",
    accuracyGain: "7-27% over CoT",
  },
  {
    id: "analogical",
    name: "Analogical Reasoning",
    description: "Have the AI self-generate analogous problems and solutions before tackling the target.",
    bestFor: ["novel problems", "math", "code from specs", "logical reasoning"],
    complexity: "medium",
    accuracyGain: "~4-10% over CoT",
  },
  {
    id: "decomposition",
    name: "Decomposition Prompting",
    description: "Break complex tasks into independent sub-tasks, solve each, then combine.",
    bestFor: ["large projects", "multi-step pipelines", "research", "project planning"],
    complexity: "medium",
    accuracyGain: "High for complex tasks",
  },
];

export function recommendTechniques(
  taskDescription: string,
  hasExamples: boolean,
  isAgentic: boolean,
  needsAccuracy: boolean
): TechniqueInfo[] {
  const desc = taskDescription.toLowerCase();
  const scored: { technique: TechniqueInfo; score: number }[] = [];

  for (const t of techniques) {
    let score = 0;

    // Keyword matching
    for (const bf of t.bestFor) {
      if (desc.includes(bf.toLowerCase())) score += 3;
    }

    // Context-based scoring
    if (hasExamples && t.id === "few-shot-cot") score += 2;
    if (!hasExamples && t.id === "zero-shot-cot") score += 2;
    if (isAgentic && t.id === "react") score += 3;
    if (isAgentic && t.id === "decomposition") score += 2;
    if (needsAccuracy && t.id === "self-consistency") score += 3;
    if (needsAccuracy && t.id === "self-refine") score += 2;

    // Task type detection
    if (desc.match(/debug|bug|error|fix/) && t.id === "chain-of-thought") score += 2;
    if (desc.match(/review|audit|check/) && t.id === "role-prompting") score += 2;
    if (desc.match(/design|architect|plan/) && t.id === "tree-of-thoughts") score += 2;
    if (desc.match(/test|generate|create/) && t.id === "few-shot-cot") score += 1;
    if (desc.match(/complex|large|multi/) && t.id === "decomposition") score += 2;
    if (desc.match(/swarm|agent|multi-agent/) && t.id === "react") score += 2;
    if (desc.match(/json|xml|schema|api/) && t.id === "structured-output") score += 2;
    if (desc.match(/safe|policy|moderat/) && t.id === "constitutional") score += 3;
    if (desc.match(/physics|chemistry|science|stem/) && t.id === "step-back") score += 3;
    if (desc.match(/prompt|template|meta/) && t.id === "meta-prompting") score += 2;

    scored.push({ technique: t, score });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((s) => s.technique);
}
