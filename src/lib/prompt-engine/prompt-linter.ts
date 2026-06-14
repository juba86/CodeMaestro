import type { PromptStructured } from "@/lib/ai/types";

export type LintSeverity = "error" | "warning" | "info";

export interface LintIssue {
  severity: LintSeverity;
  message: string;
  hint?: string;
}

export interface LintReport {
  score: number; // 0–100
  grade: "A" | "B" | "C" | "D" | "F";
  issues: LintIssue[];
  estimatedTokens: number;
  wordCount: number;
}

// Cheap, provider-agnostic token estimate (~4 chars/token for English/code).
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

// Words a senior reviewer flags as under-specified in an instruction.
const VAGUE_WORDS = [
  "good", "nice", "better", "stuff", "things", "etc", "some", "appropriate",
  "properly", "correctly", "as needed", "and so on", "various",
];

const SEVERITY_PENALTY: Record<LintSeverity, number> = {
  error: 22,
  warning: 9,
  info: 3,
};

function gradeFor(score: number): LintReport["grade"] {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 45) return "D";
  return "F";
}

/**
 * Lints a structured prompt against prompt-engineering best practices.
 * Pure and deterministic — no network/model calls — so it can run on every keystroke.
 */
export function lintPrompt(data: PromptStructured, rawXml = ""): LintReport {
  const issues: LintIssue[] = [];
  const add = (severity: LintSeverity, message: string, hint?: string) =>
    issues.push({ severity, message, hint });

  const instructions = (data.instructions || "").trim();
  const task = (data.task || "").trim();
  const context = (data.context || "").trim();
  const constraints = (data.constraints || "").trim();
  const outputFormat = (data.outputFormat || "").trim();
  const audience = (data.targetAudience || "").trim();
  const examples = data.examples || [];

  // --- Core completeness ---
  if (!instructions) {
    add("error", "No instructions/goal defined.", "Every prompt needs a clear primary instruction.");
  } else if (instructions.length < 40) {
    add("warning", "Instructions are very short.", "Add specifics: what, how, and the success criteria.");
  }

  if (!task && !instructions) {
    add("error", "Neither task nor instructions are set.");
  }

  if (!context) {
    add("info", "No context provided.", "Background/tech-stack/domain helps the model ground its answer.");
  }

  if (!constraints) {
    add("warning", "No constraints defined.", "State what to avoid, limits, and non-goals to reduce drift.");
  }

  if (!outputFormat) {
    add("warning", "Output format not specified.", "Define the exact shape (Markdown/JSON/XML, sections, length).");
  }

  if (!audience) {
    add("info", "No target audience set.", "Naming the audience tunes tone and depth.");
  }

  // --- Examples (few-shot quality) ---
  const technique = data.technique;
  const wantsExamples = technique === "few-shot-cot" || technique === "chain-of-thought";
  if (examples.length === 0 && wantsExamples) {
    add("warning", `Technique "${technique}" works best with worked examples, but none are present.`,
      "Add 2–5 examples with explicit reasoning.");
  }
  const weakExamples = examples.filter((e) => !(e.thinking || "").trim()).length;
  if (examples.length > 0 && weakExamples === examples.length) {
    add("info", "Examples have no reasoning steps.", "Add <thinking> to demonstrate the chain of thought.");
  }

  // --- Vague language ---
  const haystack = `${instructions} ${task} ${constraints}`.toLowerCase();
  const found = VAGUE_WORDS.filter((w) =>
    new RegExp(`(^|[^a-z])${w}([^a-z]|$)`, "i").test(haystack)
  );
  if (found.length > 0) {
    add("info", `Vague wording: ${found.slice(0, 5).join(", ")}.`,
      "Replace with measurable, concrete requirements.");
  }

  // --- XML well-formedness (lightweight balance check) ---
  if (rawXml.trim()) {
    const opens = [...rawXml.matchAll(/<([a-zA-Z][\w-]*)(?:\s[^>]*)?>/g)].map((m) => m[1]);
    const closes = [...rawXml.matchAll(/<\/([a-zA-Z][\w-]*)\s*>/g)].map((m) => m[1]);
    const selfClosing = [...rawXml.matchAll(/<[a-zA-Z][\w-]*(?:\s[^>]*)?\/>/g)].length;
    const balanced = opens.length - selfClosing === closes.length;
    if (!balanced) {
      add("error", "XML tags look unbalanced.", "Each opening tag needs a matching closing tag.");
    }
  }

  // --- Length / token budget ---
  const fullText = [instructions, context, constraints, task, outputFormat, audience,
    ...examples.flatMap((e) => [e.input, e.thinking, e.answer])].join(" ");
  const wordCount = fullText.trim() ? fullText.trim().split(/\s+/).length : 0;
  const estimatedTokens = estimateTokens(rawXml || fullText);
  if (estimatedTokens > 8000) {
    add("warning", `Large prompt (~${estimatedTokens.toLocaleString()} tokens).`,
      "Trim redundancy; long prompts cost more and can dilute focus.");
  }

  const penalty = issues.reduce((sum, i) => sum + SEVERITY_PENALTY[i.severity], 0);
  const score = Math.max(0, Math.min(100, 100 - penalty));

  return { score, grade: gradeFor(score), issues, estimatedTokens, wordCount };
}
