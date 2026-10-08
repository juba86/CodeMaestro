import type { PromptStructured, PromptTechnique } from "@/lib/ai/types";
import type { ModelProfile } from "./model-profile";
import { buildXml } from "./xml-builder";
import { EXAMPLE_METHOD_TAG, PROMPT_TAGS, tagPattern } from "./xml-parser";

export type LintSeverity = "error" | "warning" | "info";

export interface LintIssue {
  /** Stable id of the rule that raised the issue (e.g. "emphasis-overload"). */
  ruleId: string;
  severity: LintSeverity;
  message: string;
  hint?: string;
  /** Documentation the rule is based on. */
  sourceUrl?: string;
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
// Comparisons ("a better approach", "it's better to ...") aren't vague requirements.
const COMPARATIVE_RE = /\b(a|is|it['’]s|it is) better\b|\bbetter than\b/gi;

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

const SRC = {
  bestPractices:
    "https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices",
  migration: "https://platform.claude.com/docs/en/models/opus-5-5/migration-guide",
  refusals: "https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback",
  thinking: "https://platform.claude.com/docs/en/build-with-claude/thinking-steering-and-cost",
  fable: "https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5",
  tests: "https://platform.claude.com/docs/en/test-and-evaluate/develop-tests",
  codeBestPractices: "https://code.claude.com/docs/en/best-practices",
  opus5: "https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5",
  goal: "https://code.claude.com/docs/en/goal",
} as const;

// Techniques that make the prompt an agent run (verification + done rules).
const AGENTIC_TECHNIQUES: ReadonlySet<PromptTechnique> = new Set<PromptTechnique>([
  "react", "verification-loop", "explore-plan-code-commit", "completion-promise-loop",
  "definition-of-done", "subagent-orchestration", "evaluator-optimizer",
]);

// --- Patterns (from the research spec; thresholds are heuristics) ---

// Text-level prefill: a prompt whose last line opens the model's turn.
const PREFILL_RE = /\n\s*(Assistant|A):[^\n]*$/;
// API names, or a temperature in the API's 0–2 range ("a temperature of 25
// degrees" in a weather prompt is not a sampling setting).
const SAMPLING_RE =
  /\btop[-_][pk]\b|\btemperature\s*(=|:|to|of)?\s*([01](\.\d+)?|2(\.0+)?)(?!\d|\.\d|\s*(°|degrees?|grad|%))/i;
const BUDGET_TOKENS_RE = /\bbudget_tokens\b/;

const REASONING_TAG_RE = /<\s*(thinking|scratchpad|reasoning|inner[_ -]?monologue|chain[_-]?of[_-]?thought)\b/i;
// The spec's "(show|explain|...) ... work" also matched phrases like "include
// the work items"; "work" only counts as "show your work".
const REASONING_ASK_RE =
  /\b((show|explain|write out|output|include) (all |your |the )?(full |complete |step[- ]by[- ]step )?(reasoning|thought process|chain of thought)|show (all )?your work)\b/i;
const REASONING_NOUN_RE = /\b(inner monologue|scratchpad|reasoning trace|running log of (your )?reasoning|reasoning verbatim)\b/i;
const REASONING_FIELD_RE = /["'](reasoning|thinking|thoughts?|trace|chain_of_thought|scratchpad)["']\s*:/i;

const THINK_STEP_RE =
  /\b(let'?s think step[- ]by[- ]step|think step[- ]by[- ]step|think (carefully|hard|harder|deeply) (before|about)|take a deep breath)\b/i;

const EMPHASIS_RE = /\b(CRITICAL|IMPORTANT|MUST|NEVER|ALWAYS|REQUIRED|MANDATORY)\b/g;
const CAPS_WORD_RE = /\b[A-Z]{4,}\b/g;
const CAPS_ALLOWED: ReadonlySet<string> = new Set([
  "JSON", "JSONL", "HTML", "HTTP", "HTTPS", "CSS", "YAML", "TOML", "README", "TODO", "CLAUDE", "AGENTS",
  "UUID", "CRUD", "REST", "WCAG", "SPEC", "PLAN", "NOTE", "CORS", "CSRF", "OWASP", "OAUTH", "ASCII",
  "NULL", "TRUE", "FALSE", "POST", "PATCH", "DELETE", "HEAD", "OPTIONS", "SELECT", "INSERT", "UPDATE",
  "WHERE", "FROM", "GRAPHQL", "WASM", "CHANGELOG", "LICENSE", "CONTRIBUTING",
]);
const OVERTRIGGER_RE = /\b(if in doubt,? (use|call)|default to using)\b/i;

const NEGATIVE_START_RE = /^\s*([-*•]|\d+\.)?\s*(do not|don['’]t|never|avoid|no)\b/i;
const POSITIVE_ALT_RE = /\b(instead|rather|use|prefer|write|keep|replace|only)\b/i;
// The alternative is looked for after the negated verb, or "Do not use
// markdown" (the docs' own example) would count "use" as one.
const negativeOnly = (s: string) =>
  NEGATIVE_START_RE.test(s) && !POSITIVE_ALT_RE.test(s.replace(NEGATIVE_START_RE, "").replace(/^\s*\S+/, ""));

// "only" in compounds ("read-only", "syntax-only") or "not only" isn't a rule.
const RULE_RE = /\b(never|always|must|do not|don['’]t)\b|(?<![-\w]|not )only\b/i;
// The spec's pattern, plus ", so ..." (as in "..., so the diff stays reviewable").
const REASON_RE =
  /(\b(because|so that|so the|since|otherwise|to (avoid|prevent|keep|ensure|protect)|in order to|which would|as it)\b|, so\b)/i;

const DONE_RE =
  /\b(done means|definition of done|success criteria|acceptance criteria|is (complete|done|finished) when|exits? 0|must pass|all tests pass|until .{0,60}(pass|passes|succeeds|green))\b/i;
const BUILD_VERB_RE = /\b(implement|fix|refactor|migrate|build|add|create|generate|write)\b/i;
const CODING_TASK_RE =
  /\b(implement|fix|refactor|migrate|add (a )?feature|build|write (the )?code|bug|endpoint|component)\b/i;
// The spec's verb lists alone also match "Build a marketing plan" or "Fix the
// grammar in this email"; the text triggers additionally need a coding signal.
const CODE_VERB_RE = /\b(implement\w*|refactor\w*|migrat\w*|debug\w*)\b/i;
const CODE_NOUN_RE =
  /\b(code|codebase|repo(sitory)?|functions?|class(es)?|modules?|files?|tests?|api|endpoints?|components?|bugs?|features?|scripts?|cli|apps?|services?|databases?|schemas?|quer(y|ies)|frontend|backend|server|library|package|typescript|javascript|python|rust|golang|java|sql|react|next\.?js|node(\.?js)?|pull request|commits?)\b/i;
const isCodeWork = (text: string) => CODE_VERB_RE.test(text) || CODE_NOUN_RE.test(text);
// A check the agent can run. {{CHECK_COMMAND}}-style placeholders count.
const CHECK_RE =
  /(\b(npm|pnpm|yarn|bun) (run )?(test|build|lint|typecheck|check)\b|pytest|go test|cargo (test|check)|tsc\b|vitest|jest|make (test|check)|run (the )?tests?|test suite|type-?check|screenshot|exits? 0|build succeeds|\{\{\s*(CHECK|TEST|BUILD|LINT)_(COMMAND|CMD)\s*\}\})/i;

// Harness loops and goal conditions. A plain "iterate until the tests pass"
// inside one interactive run is bounded by the run itself, so it doesn't
// count (the spec's broader "until … pass" trigger flagged every
// verification loop). Slash commands must not match paths like lib/loop.ts.
const LOOP_TEXT_RE =
  /((^|[^\w./-])\/(goal|loop|ralph-loop)\b(?!\.)|\b(keep (working|going|iterating)|repeat|loop) until\b)/i;
const BOUND_RE =
  /(stop after \d+|max(imum)?[ -]?(iterations|turns|rounds|attempts)|--max-(iterations|turns)|--max-budget-usd|at most \d+ (iterations|turns|rounds|attempts)|\b\d+ (iterations|turns|rounds)\b|\{\{\s*MAX_[A-Z_]+\s*\}\})/i;
const MARKER_RE = /<promise>[^<]+<\/promise>|completion[ -](promise|marker)/i;

// Techniques whose deliverable is a spec or a plan, not a code change: their
// text ("I want to build ...") doesn't make the prompt an agentic coding run.
const NON_CODING_TECHNIQUES: ReadonlySet<PromptTechnique> = new Set<PromptTechnique>(["interview-then-spec"]);

// The spec's pattern, plus spelled-out counts ("five lines", "one-paragraph").
const LENGTH_RE =
  /(\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)[\s-]*(words?|sentences?|lines?|bullets?|paragraphs?|items?|headings?|chars?|characters?|tokens?|pages?)\b|\b(concise|brief|short|terse|detailed|in-depth|at most|no more than|under \d+|max(imum)? \d+|lead with)\b)/i;
const SCHEMA_FORMAT_RE = /json|schema|xml/i;

// ~20k tokens: the docs' threshold for putting long documents first.
const LONG_INPUT_TOKENS = 20_000;

/** Splits text into sentences (line breaks, then ". " / "! " / "? "). */
function sentences(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\n+/)) {
    const re = /[.!?]+\s+/g;
    let start = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      out.push(line.slice(start, m.index + m[0].length).trim());
      start = m.index + m[0].length;
    }
    out.push(line.slice(start).trim());
  }
  return out.filter(Boolean);
}

/** Drops quoted text ('Format code properly' quoted as a bad example). */
function withoutQuotes(text: string): string {
  return text.replace(/"[^"\n]*"|“[^”\n]*”|„[^“”\n]*[“”]|(^|[\s(])'[^'\n]+'(?=[\s.,;:)!?]|$)/g, "$1 ");
}

// Structure the parser reads: top-level sections anywhere, example fields
// inside <examples>, agents inside <swarm-config>. Other tags (<promise>,
// <documents>, a mention of "<answer> tags") are content.
const STRUCTURE_SCOPES: { scope: RegExp | null; names: readonly string[] }[] = [
  { scope: null, names: PROMPT_TAGS },
  {
    scope: new RegExp(`<${tagPattern("examples")}(?:\\s[^>]*)?>[\\s\\S]*?</${tagPattern("examples")}\\s*>`, "gi"),
    names: ["example", "input", EXAMPLE_METHOD_TAG, "thinking", "answer"],
  },
  {
    scope: new RegExp(`<${tagPattern("swarm-config")}(?:\\s[^>]*)?>[\\s\\S]*?</${tagPattern("swarm-config")}\\s*>`, "gi"),
    names: ["agents", "agent"],
  },
];

/** Structure tags whose open and close counts differ. */
function unbalancedTags(xml: string): string[] {
  const out: string[] = [];
  for (const { scope, names } of STRUCTURE_SCOPES) {
    const text = scope ? (xml.match(scope) ?? []).join("\n") : xml;
    for (const name of names) {
      const n = tagPattern(name);
      const opens = text.match(new RegExp(`<${n}(?:\\s[^>]*)?>`, "gi"))?.length ?? 0;
      const closes = text.match(new RegExp(`</${n}\\s*>`, "gi"))?.length ?? 0;
      if (opens !== closes) out.push(name);
    }
  }
  return out;
}

/** Drops literals whose capitals aren't emphasis: placeholders, code, quoted labels, file names. */
function withoutLiterals(text: string): string {
  return text
    .replace(/\{\{[^}]*\}\}/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/(["'])[A-Z][A-Z0-9_ -]*\1/g, " ")
    .replace(/>[A-Z][A-Z0-9_ -]*</g, "><")
    .replace(/\b[A-Z][A-Z0-9_-]*\.[a-z]{1,5}\b/g, " ");
}

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

function clip(s: string, n = 60): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/**
 * Lints a structured prompt against current prompt-engineering guidance.
 * Pure and deterministic — no network/model calls — so it can run on every
 * keystroke. `target` (see getModelProfile) enables model-specific rules;
 * without it they run conservatively (lower severity, or skipped when they
 * only apply to known models).
 */
export function lintPrompt(data: PromptStructured, rawXml = "", target?: ModelProfile): LintReport {
  const issues: LintIssue[] = [];
  const add = (ruleId: string, severity: LintSeverity, message: string, hint?: string, sourceUrl?: string) =>
    issues.push({ ruleId, severity, message, hint, sourceUrl });

  const instructions = (data.instructions || "").trim();
  const task = (data.task || "").trim();
  const context = (data.context || "").trim();
  const constraints = (data.constraints || "").trim();
  const outputFormat = (data.outputFormat || "").trim();
  const audience = (data.targetAudience || "").trim();
  const examples = data.examples || [];
  const technique = data.technique;
  const exampleText = examples.flatMap((e) => [e.input, e.thinking, e.answer]);
  const allFields = [instructions, context, constraints, task, outputFormat, audience, ...exampleText];
  const directive = [instructions, constraints, task, outputFormat].join("\n");
  const everything = allFields.join("\n");

  // --- Core completeness ---
  if (!instructions) {
    add("missing-instructions", "error", "No instructions/goal defined.", "Every prompt needs a clear primary instruction.");
  } else if (instructions.length < 40) {
    add("short-instructions", "warning", "Instructions are very short.", "Add specifics: what, how, and the success criteria.");
  }

  if (!task && !instructions) {
    add("missing-task", "error", "Neither task nor instructions are set.");
  }

  if (!context) {
    add("missing-context", "info", "No context provided.", "Background/tech-stack/domain helps the model ground its answer.");
  }

  if (!constraints) {
    add("missing-constraints", "warning", "No constraints defined.",
      "State the limits and non-goals that matter, each with the reason behind it.");
  }

  if (!outputFormat) {
    add("missing-output-format", "warning", "Output format not specified.",
      "Define the shape (Markdown/JSON/XML, sections) and the length.");
  }

  if (!audience) {
    add("missing-audience", "info", "No target audience set.", "Naming the audience tunes tone and depth.");
  }

  // --- Examples ---
  const wantsExamples = technique === "few-shot-cot" || technique === "chain-of-thought";
  if (examples.length === 0 && wantsExamples) {
    add("missing-examples", "warning", `Technique "${technique}" works best with examples, but none are present.`,
      "Add 3–5 relevant, diverse examples (input, method, answer).", SRC.bestPractices);
  }
  if (wantsExamples && examples.length > 0 && examples.every((e) => !(e.thinking || "").trim())) {
    add("examples-without-method", "info", "Examples don't show how their answers were derived.",
      "Add the method/approach for each example.", SRC.bestPractices);
  }

  if (examples.length > 0 || technique === "few-shot-cot") {
    const problems: string[] = [];
    if (examples.length > 5) problems.push(`${examples.length} examples (more than 5)`);
    else if (technique === "few-shot-cot" && examples.length > 0 && examples.length < 3) {
      problems.push(`only ${examples.length} example${examples.length === 1 ? "" : "s"}`);
    }
    const inputs = examples.map((e) => words(e.input || ""));
    dup: for (let i = 0; i < inputs.length; i++) {
      for (let j = i + 1; j < inputs.length; j++) {
        if (jaccard(inputs[i], inputs[j]) >= 0.8) {
          problems.push(`examples ${i + 1} and ${j + 1} have nearly identical inputs`);
          break dup;
        }
      }
    }
    const heads = examples.map((e) => (e.answer || "").trim().toLowerCase().split(/\s+/));
    if (heads.length >= 2 && heads.every((h) => h.length >= 5)) {
      const first = heads[0].slice(0, 5).join(" ");
      if (heads.every((h) => h.slice(0, 5).join(" ") === first)) {
        problems.push("all answers start with the same five words");
      }
    }
    if (problems.length > 0) {
      add("examples-count-variety", "info", `The examples may be too few, too many, or too similar: ${problems.join("; ")}.`,
        "Use 3–5 examples that mirror real inputs and cover edge cases, varied enough that the model doesn't copy unintended patterns. Start with one and add more only if outputs miss.",
        SRC.bestPractices);
    }
  }

  // --- Vague language ---
  const haystack = withoutQuotes(`${instructions}\n${task}\n${constraints}`).replace(COMPARATIVE_RE, " ").toLowerCase();
  const found = VAGUE_WORDS.filter((w) =>
    new RegExp(`(^|[^a-z])${w}([^a-z]|$)`, "i").test(haystack)
  );
  if (found.length > 0) {
    add("vague-wording", "info", `Vague wording: ${found.slice(0, 5).join(", ")}.`,
      "Replace with measurable, concrete requirements.");
  }

  // --- Requests the target model rejects (text-level; request params aren't
  // part of the prompt data) ---
  {
    const problems: string[] = [];
    let severity: LintSeverity = "warning";
    if (PREFILL_RE.test(task) || PREFILL_RE.test(rawXml.trimEnd())) {
      if (target?.rejectsPrefill) {
        problems.push("ends with an assistant turn (prefill)");
        severity = "error";
      } else if (!target) {
        problems.push("ends with an assistant turn (prefill), which Claude 4.6+ rejects");
      }
    }
    if (target?.rejectsSampling && SAMPLING_RE.test(directive)) problems.push("sets temperature/top_p/top_k");
    if ((target?.version ?? 0) >= 407 && BUDGET_TOKENS_RE.test(directive)) problems.push("uses thinking.budget_tokens");
    if (problems.length > 0) {
      add("unsupported-request-params", severity,
        `This prompt ${problems.join(" and ")}${target ? `, which ${target.label} rejects with HTTP 400` : ""}.`,
        "Remove the trailing assistant line; put 'Respond directly without preamble.' in the instructions or use structured outputs for format. Steer with the prompt and the effort setting, not temperature.",
        SRC.migration);
    }
  }

  // --- Visible reasoning requests (reasoning_extraction refusals) ---
  // Tags count anywhere; phrasing only where it instructs the model, so that
  // background text (e.g. a "scratchpad directory" in pasted docs) doesn't.
  {
    const asks = `${directive}\n${audience}`;
    const hit =
      allFields.map((f) => f.match(REASONING_TAG_RE)?.[0]).find(Boolean) ??
      rawXml.match(REASONING_TAG_RE)?.[0] ??
      asks.match(REASONING_ASK_RE)?.[0] ??
      asks.match(REASONING_NOUN_RE)?.[0] ??
      asks.match(REASONING_FIELD_RE)?.[0];
    if (hit) {
      add("reasoning-extraction-risk", target?.reasoningExtractionRisk ? "error" : "warning",
        `The prompt asks the model to write out its reasoning ("${clip(hit.trim(), 40)}"). Current Claude models may refuse this with stop_reason "refusal" (reasoning_extraction), and the refusal is billed.`,
        "Ask for 'a short explanation', 'the evidence behind the result' or 'a summary of the actions taken'. Rename a schema field to brief_explanation or evidence, and an example's <thinking> to <method>. To read the reasoning, use the thinking blocks with display:'summarized'.",
        SRC.refusals);
    }
  }

  // --- Obsolete "think step by step" boilerplate ---
  // Skipped for a known target without built-in thinking: there, "Think
  // carefully before responding" is the documented fallback (zero-shot-cot).
  if (!target || target.adaptiveThinking) {
    const hit = `${instructions}\n${task}\n${constraints}`.match(THINK_STEP_RE)?.[0];
    if (hit) {
      add("obsolete-think-step-by-step", target ? "warning" : "info",
        `"${clip(hit, 40)}" style boilerplate is outdated on models with built-in adaptive thinking.`,
        "Delete the line and set the effort level instead (low/medium/high/xhigh/max). In Claude Code, only the keyword 'ultrathink' raises reasoning for a turn.",
        SRC.thinking);
    }
  }

  // --- Shouted emphasis (threshold of 2 is a heuristic) ---
  {
    const text = withoutLiterals([instructions, constraints, task, outputFormat, audience].join("\n"));
    const emphasis = text.match(EMPHASIS_RE) ?? [];
    const emphasisSet = new Set(emphasis);
    const caps = (text.match(CAPS_WORD_RE) ?? []).filter((w) => !CAPS_ALLOWED.has(w) && !emphasisSet.has(w));
    const bangLines = text.split("\n").filter((l) => (l.match(/!/g) ?? []).length >= 3).length;
    const total = emphasis.length + caps.length + bangLines;
    const overtrigger = text.match(OVERTRIGGER_RE)?.[0];
    if (total > 2 || overtrigger) {
      const what = [
        total > 2 ? `${total} shouted words or lines (${[...new Set([...emphasis, ...caps])].slice(0, 4).join(", ")})` : "",
        overtrigger ? `"${overtrigger}"` : "",
      ].filter(Boolean).join(" and ");
      add("emphasis-overload", "warning",
        `Too much shouted emphasis: ${what}. Newer Claude models overtrigger on aggressive wording, and when many lines are emphasized none stands out.`,
        "Rewrite in a normal tone ('Use this tool when...') and add the reason. If one instruction keeps getting skipped, put 'IMPORTANT' on that line only.",
        SRC.bestPractices);
    }
  }

  // --- Prohibitions without an alternative ---
  {
    const inBody = [...sentences(instructions), ...sentences(constraints)].filter(negativeOnly);
    const inFormat = sentences(outputFormat).filter(negativeOnly);
    if (inBody.length + inFormat.length >= 2 || inFormat.length >= 1) {
      add("negative-only-instruction", "info",
        `${inBody.length + inFormat.length} instruction(s) only say what not to do, e.g. "${clip([...inFormat, ...inBody][0])}".`,
        "Say what to do instead: replace 'Do not use markdown' with 'Write your response as smoothly flowing prose paragraphs.' Positive examples of the wanted style work better than lists of prohibitions.",
        SRC.bestPractices);
    }
  }

  // --- Hard rules without a reason ---
  {
    const bare = [...sentences(constraints), ...sentences(instructions)].filter(
      (s) => RULE_RE.test(s) && !REASON_RE.test(s)
    );
    if (bare.length >= 2) {
      add("rule-without-reason", "info",
        `${bare.length} hard rules have no reason attached: ${bare.slice(0, 3).map((s) => `"${clip(s, 50)}"`).join(", ")}.`,
        "Add the reason, e.g. 'never use ellipses, because a text-to-speech engine will read this and can't pronounce them'. Claude generalizes from the explanation to cases the rule doesn't name.",
        SRC.fable);
    }
  }

  // --- Agentic work: definition of done and a runnable check ---
  const agenticTechnique = !!technique && AGENTIC_TECHNIQUES.has(technique);
  const request = `${task}\n${instructions}`;
  const codingText = !(technique && NON_CODING_TECHNIQUES.has(technique)) && isCodeWork(request);
  const taskText = task || instructions;
  if ((agenticTechnique || (codingText && BUILD_VERB_RE.test(taskText))) && !DONE_RE.test(directive)) {
    add("missing-definition-of-done", "warning", "No definition of done or success criteria.",
      "State one measurable end state with a check and the constraints that matter, e.g. 'Done means: every endpoint uses the new client, the old client is deleted, and the test suite passes.' The same sentence works as a /goal condition.",
      SRC.tests);
  }

  const hasCheck = CHECK_RE.test(everything);
  if ((agenticTechnique || (codingText && CODING_TASK_RE.test(request))) && !hasCheck) {
    add("agentic-missing-verification", "warning", "This is an agentic coding prompt with no check the agent can run.",
      "Add a check Claude can run, such as the test command, type-check, build or a screenshot comparison, and ask for evidence: the command and its output." +
        (target?.family === "claude5" && target.line === "opus"
          ? " On Opus, add the concrete check only and leave out generic 'double-check your work' lines."
          : ""),
      SRC.codeBestPractices);
  }

  // --- Loops and goal conditions need a bound, a check and a marker ---
  // Triggered by the directive fields (a /goal mentioned in background text
  // isn't a loop); bound, check and marker may sit anywhere.
  if (technique === "completion-promise-loop" || technique === "definition-of-done" || LOOP_TEXT_RE.test(directive)) {
    const hint =
      "Add 'or stop after N turns' or a max-iterations or budget cap, a check the transcript can prove (e.g. '`npm test` exits 0'), and an exact completion marker printed only when the condition is true. Set the cap in the harness too, not only in the prompt.";
    if (!BOUND_RE.test(everything)) {
      add("unbounded-loop", "error", "This loop or goal prompt has no iteration bound.", hint, SRC.goal);
    }
    if (!hasCheck) {
      add("unbounded-loop", "error", "This loop or goal prompt has no verifiable check.", hint, SRC.goal);
    }
    if (technique === "completion-promise-loop" && !MARKER_RE.test(everything)) {
      add("unbounded-loop", "error", "This loop prompt has no completion marker.", hint, SRC.goal);
    }
  }

  // --- Long input placed after the instructions or question ---
  if (estimateTokens(context) >= LONG_INPUT_TOKENS) {
    const xml = rawXml || buildXml(data);
    const ctxAt = xml.search(/<context[\s>]/i);
    if (ctxAt > 0) {
      const before = xml.slice(0, ctxAt);
      if (/<(instructions|task)[\s>]/i.test(before) || /\?[ \t]*$/m.test(before)) {
        add("long-input-after-query", "warning",
          `A long context (~${estimateTokens(context).toLocaleString()} tokens) comes after the instructions or question.`,
          "Put long documents at the top, in <documents><document index=\"n\"><source>...</source><document_content>...</document_content></document></documents>, and the question last. The docs report up to 30% better quality on complex multi-document inputs with this layout.",
          SRC.bestPractices);
      }
    }
  }

  // --- Output length ---
  if (outputFormat && !SCHEMA_FORMAT_RE.test(outputFormat) && !LENGTH_RE.test(`${outputFormat}\n${instructions}`)) {
    add("no-length-guidance", "info", "No guidance on output length or verbosity.",
      "Say how long the output should be, or what it should lead with, e.g. 'Lead with the outcome in one sentence, then supporting detail'." +
        (target?.family === "claude5" && target.line === "opus" ? " Opus writes longer by default, and lowering effort doesn't reliably shorten it." : ""),
      SRC.opus5);
  }

  // --- XML well-formedness: the builder's own structure tags must pair up,
  // or sections get lost or swallowed when the XML is read back ---
  if (rawXml.trim()) {
    const unbalanced = unbalancedTags(rawXml);
    if (unbalanced.length > 0) {
      add("xml-unbalanced", "error",
        `XML tags look unbalanced: ${unbalanced.slice(0, 3).map((t) => `<${t}>`).join(", ")}.`,
        "Each section tag needs a matching closing tag. Tags inside a section's text, such as <promise>, don't matter here.");
    }
  }

  // --- Length / token budget ---
  const fullText = [instructions, context, constraints, task, outputFormat, audience, ...exampleText].join(" ");
  const wordCount = fullText.trim() ? fullText.trim().split(/\s+/).length : 0;
  const estimatedTokens = estimateTokens(rawXml || fullText);
  if (estimatedTokens > 8000) {
    add("large-prompt", "warning", `Large prompt (~${estimatedTokens.toLocaleString()} tokens).`,
      "Trim redundancy; long prompts cost more and can dilute focus.");
  }

  const penalty = issues.reduce((sum, i) => sum + SEVERITY_PENALTY[i.severity], 0);
  const score = Math.max(0, Math.min(100, 100 - penalty));

  return { score, grade: gradeFor(score), issues, estimatedTokens, wordCount };
}
