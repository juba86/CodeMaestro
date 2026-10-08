import { describe, expect, it } from "vitest";
import type { PromptExample, PromptStructured } from "@/lib/ai/types";
import { getModelProfile, type ModelProfile } from "./model-profile";
import { estimateTokens, lintPrompt, type LintIssue } from "./prompt-linter";
import { buildXml } from "./xml-builder";

const OPUS_55 = getModelProfile("claude", "claude-opus-5-5");
const SONNET_55 = getModelProfile("claude", "claude-sonnet-5-5");
const HAIKU_55 = getModelProfile("claude", "claude-haiku-5-5");
const SONNET_45 = getModelProfile("claude", "claude-sonnet-4-5");
const GPT_4O = getModelProfile("openai", "gpt-4o");

const PROFILES: [string, ModelProfile | undefined][] = [
  ["no target", undefined],
  ["Opus 5.5", OPUS_55],
  ["Sonnet 5.5", SONNET_55],
  ["Haiku 5.5", HAIKU_55],
  ["Sonnet 4.5", SONNET_45],
  ["gpt-4o", GPT_4O],
];

// The rules from the research spec (src: research-spec.json lintRules).
const SPEC_RULES = [
  "unsupported-request-params",
  "reasoning-extraction-risk",
  "obsolete-think-step-by-step",
  "emphasis-overload",
  "negative-only-instruction",
  "rule-without-reason",
  "missing-definition-of-done",
  "agentic-missing-verification",
  "long-input-after-query",
  "examples-count-variety",
  "no-length-guidance",
  "unbounded-loop",
] as const;
type RuleId = (typeof SPEC_RULES)[number];

// A complete, current-style prompt: every section filled, reasons attached to
// rules, a length bound, no build verbs (so no definition of done is needed).
const GOOD: PromptStructured = {
  instructions:
    "Review the attached pull request diff and list the defects that change runtime behavior, so the maintainers can decide what to repair before the release.",
  context: "TypeScript service on Node 22. The diff touches the session store and its tests.",
  constraints:
    "Report only defects that change behavior, because style comments drown out the real problems.\nQuote the affected line for each finding so reviewers can locate it quickly.",
  examples: [],
  task: "Review the diff in the context section.",
  targetAudience: "Maintainers of the service",
  outputFormat: "Markdown list of at most 10 bullets, one sentence each; lead with the most severe defect.",
};

// A coding task that has both a definition of done and a runnable check.
const GOOD_CODING: PromptStructured = {
  ...GOOD,
  instructions:
    "Implement the password reset endpoint in src/api/reset.ts, following the pattern of src/api/login.ts so the two stay consistent.",
  task: "Implement the endpoint. Done means: a valid token resets the password and `npm test` exits 0.",
};

function lint(data: PromptStructured, target?: ModelProfile, rawXml = buildXml(data)) {
  return lintPrompt(data, rawXml, target);
}

function issuesOf(data: PromptStructured, rule: RuleId, target?: ModelProfile, rawXml?: string): LintIssue[] {
  return lint(data, target, rawXml).issues.filter((i) => i.ruleId === rule);
}

const example = (input: string, answer: string, thinking = ""): PromptExample => ({ id: input, input, thinking, answer });

describe("lintPrompt: good prompts stay quiet", () => {
  it.each(PROFILES)("no spec rule fires on a good prompt (%s)", (_name, target) => {
    const report = lint(GOOD, target);
    expect(report.issues).toEqual([]);
    expect(report.grade).toBe("A");
  });

  it.each(PROFILES)("no spec rule fires on a good coding prompt (%s)", (_name, target) => {
    const ids = lint(GOOD_CODING, target).issues.map((i) => i.ruleId);
    for (const rule of SPEC_RULES) expect(ids).not.toContain(rule);
  });

  it("every issue carries a rule id, and spec rules link their source", () => {
    const bad: PromptStructured = {
      ...GOOD,
      instructions: "CRITICAL: You MUST ALWAYS fix the bug. Let's think step by step. Show your reasoning in <thinking> tags.",
      constraints: "Never add comments.\nDo not use markdown.",
      outputFormat: "Plain text",
      task: "Fix the bug and keep working until done.",
    };
    const issues = lint(bad, OPUS_55).issues;
    expect(issues.length).toBeGreaterThan(5);
    for (const issue of issues) {
      expect(issue.ruleId).toMatch(/^[a-z]+(-[a-z0-9]+)*$/);
      if ((SPEC_RULES as readonly string[]).includes(issue.ruleId)) {
        expect(issue.sourceUrl).toMatch(/^https:\/\//);
        expect(issue.hint).toBeTruthy();
      }
    }
  });
});

describe("lintPrompt: each spec rule fires on a minimal bad prompt", () => {
  it("unsupported-request-params: trailing assistant prefill", () => {
    const bad = { ...GOOD, task: "Review the diff.\n\nAssistant: Here are the defects" };
    expect(issuesOf(bad, "unsupported-request-params", OPUS_55)[0]?.severity).toBe("error");
    // Unknown target: still worth a warning.
    expect(issuesOf(bad, "unsupported-request-params")[0]?.severity).toBe("warning");
    // Models that accept prefill: quiet.
    expect(issuesOf(bad, "unsupported-request-params", SONNET_45)).toEqual([]);
    expect(issuesOf(bad, "unsupported-request-params", GPT_4O)).toEqual([]);
  });

  it("unsupported-request-params: sampling parameters only for models that reject them", () => {
    const bad = { ...GOOD, constraints: `${GOOD.constraints}\nSet temperature to 0 so the output is reproducible.` };
    expect(issuesOf(bad, "unsupported-request-params", OPUS_55)).toHaveLength(1);
    expect(issuesOf(bad, "unsupported-request-params", GPT_4O)).toEqual([]);
    expect(issuesOf(bad, "unsupported-request-params", SONNET_45)).toEqual([]);
  });

  it("reasoning-extraction-risk: error on Claude 5 models at risk, warning elsewhere", () => {
    const bad = { ...GOOD, instructions: `${GOOD.instructions} Show your reasoning in <thinking> tags first.` };
    expect(issuesOf(bad, "reasoning-extraction-risk", OPUS_55)[0]?.severity).toBe("error");
    expect(issuesOf(bad, "reasoning-extraction-risk", SONNET_55)[0]?.severity).toBe("error");
    expect(issuesOf(bad, "reasoning-extraction-risk", HAIKU_55)[0]?.severity).toBe("warning");
    expect(issuesOf(bad, "reasoning-extraction-risk", GPT_4O)[0]?.severity).toBe("warning");
    expect(issuesOf(bad, "reasoning-extraction-risk")[0]?.severity).toBe("warning");
  });

  it("reasoning-extraction-risk: reasoning fields in a JSON schema and scratchpads", () => {
    const schema = { ...GOOD, outputFormat: 'JSON: {"reasoning": string, "verdict": "ok" | "defect"}' };
    expect(issuesOf(schema, "reasoning-extraction-risk", OPUS_55)).toHaveLength(1);
    const scratch = { ...GOOD, constraints: `${GOOD.constraints}\nUse a scratchpad before you answer.` };
    expect(issuesOf(scratch, "reasoning-extraction-risk", OPUS_55)).toHaveLength(1);
  });

  it("reasoning-extraction-risk: an example's method is not a reasoning request", () => {
    // The builder renders PromptExample.thinking as <method>, not <thinking>.
    const withMethod = {
      ...GOOD,
      examples: [
        example("null check missing in getUser", "Line 12 dereferences user before the guard.", "Trace where user can be undefined."),
        example("off-by-one in paginate", "The last page is skipped when total % size == 0.", "Compare loop bounds to the total."),
        example("race in cache refresh", "Two refreshes can interleave and drop a write.", "Look for awaits between read and write."),
      ],
    };
    expect(issuesOf(withMethod, "reasoning-extraction-risk", OPUS_55)).toEqual([]);
  });

  it("obsolete-think-step-by-step: warning with adaptive thinking, info for an unknown target", () => {
    const bad = { ...GOOD, instructions: `${GOOD.instructions} Let's think step by step.` };
    expect(issuesOf(bad, "obsolete-think-step-by-step", OPUS_55)[0]?.severity).toBe("warning");
    expect(issuesOf(bad, "obsolete-think-step-by-step")[0]?.severity).toBe("info");
    // Without built-in thinking the documented fallback line is the right advice.
    expect(issuesOf(bad, "obsolete-think-step-by-step", SONNET_45)).toEqual([]);
    expect(issuesOf(bad, "obsolete-think-step-by-step", GPT_4O)).toEqual([]);
  });

  it("emphasis-overload: shouted words and overtriggering phrases", () => {
    const shouted = {
      ...GOOD,
      constraints: "CRITICAL: You MUST report every defect, because missed ones ship. NEVER skip a file, because each one ships.",
    };
    expect(issuesOf(shouted, "emphasis-overload", OPUS_55)).toHaveLength(1);
    const overtrigger = { ...GOOD, instructions: `${GOOD.instructions} If in doubt, use the search tool.` };
    expect(issuesOf(overtrigger, "emphasis-overload", OPUS_55)).toHaveLength(1);
    // Acronyms, placeholders and code are not emphasis.
    const literals = {
      ...GOOD,
      constraints: `${GOOD.constraints}\nReturn JSON for the HTTP API described in README.md; fill {{CHECK_COMMAND}} with \`NODE_ENV=test npm run check\`.`,
    };
    expect(issuesOf(literals, "emphasis-overload", OPUS_55)).toEqual([]);
  });

  it("negative-only-instruction: prohibitions without an alternative", () => {
    const bad = { ...GOOD, constraints: "Do not comment on style.\nNever mention formatting." };
    expect(issuesOf(bad, "negative-only-instruction")).toHaveLength(1);
    const inFormat = { ...GOOD, outputFormat: "At most 10 bullets.\nNo tables." };
    expect(issuesOf(inFormat, "negative-only-instruction")).toHaveLength(1);
    const withAlternative = {
      ...GOOD,
      constraints: "Do not comment on style; report behavior changes instead.\nNever use tables; use a bullet list rather than a grid.",
    };
    expect(issuesOf(withAlternative, "negative-only-instruction")).toEqual([]);
  });

  it("rule-without-reason: two or more bare hard rules", () => {
    const bad = { ...GOOD, constraints: "Always quote the affected line.\nOnly report behavior changes." };
    expect(issuesOf(bad, "rule-without-reason")).toHaveLength(1);
    const oneBare = { ...GOOD, constraints: `${GOOD.constraints}\nAlways quote the affected line.` };
    expect(issuesOf(oneBare, "rule-without-reason")).toEqual([]);
  });

  it("missing-definition-of-done: build tasks and agentic techniques without an end state", () => {
    const bad = { ...GOOD_CODING, task: "Implement the endpoint and run `npm test`." };
    expect(issuesOf(bad, "missing-definition-of-done")).toHaveLength(1);
    const technique = { ...GOOD, technique: "verification-loop" as const };
    expect(issuesOf(technique, "missing-definition-of-done")).toHaveLength(1);
    expect(issuesOf(GOOD_CODING, "missing-definition-of-done")).toEqual([]);
  });

  it("agentic-missing-verification: coding work without a runnable check", () => {
    const bad = { ...GOOD_CODING, task: "Implement the endpoint. Done means: a valid token resets the password." };
    expect(issuesOf(bad, "agentic-missing-verification")).toHaveLength(1);
    const placeholder = { ...bad, constraints: `${GOOD.constraints}\nRun {{CHECK_COMMAND}} after each change.` };
    expect(issuesOf(placeholder, "agentic-missing-verification")).toEqual([]);
    const technique = { ...GOOD, technique: "subagent-orchestration" as const };
    expect(issuesOf(technique, "agentic-missing-verification")).toHaveLength(1);
  });

  it("long-input-after-query: a ~20k-token context after the instructions", () => {
    const doc = "Log line with details about the request handling. ".repeat(1700);
    expect(estimateTokens(doc)).toBeGreaterThanOrEqual(20_000);
    const data = { ...GOOD, context: doc };
    const queryFirst = `<instructions>${GOOD.instructions}</instructions>\n\n<context>${doc}</context>\n\n<task>${GOOD.task}</task>`;
    expect(issuesOf(data, "long-input-after-query", undefined, queryFirst)).toHaveLength(1);
    const docsFirst = `<context>${doc}</context>\n\n<instructions>${GOOD.instructions}</instructions>\n\n<task>${GOOD.task}</task>`;
    expect(issuesOf(data, "long-input-after-query", undefined, docsFirst)).toEqual([]);
    // A short context never triggers it, whatever the order.
    expect(issuesOf(GOOD, "long-input-after-query", undefined, queryFirst.replace(doc, "short"))).toEqual([]);
  });

  it("examples-count-variety: too many, too few for few-shot, near-duplicates, one pattern", () => {
    const diverse = [
      example("null check missing in getUser", "Line 12 dereferences user before the guard."),
      example("off-by-one in paginate", "The last page is skipped when total is a multiple of size."),
      example("race in cache refresh", "Two refreshes can interleave and drop a write."),
    ];
    const six = [...diverse, ...diverse.map((e, i) => example(`${e.input} variant ${i} with extra unrelated words here`, `${i} ${e.answer}`))];
    expect(issuesOf({ ...GOOD, examples: six }, "examples-count-variety")).toHaveLength(1);
    expect(issuesOf({ ...GOOD, technique: "few-shot-cot", examples: diverse.slice(0, 2) }, "examples-count-variety")).toHaveLength(1);
    const dupes = [example("null check missing in getUser", "A."), example("null check missing in getUser()", "B.")];
    expect(issuesOf({ ...GOOD, examples: dupes }, "examples-count-variety")).toHaveLength(1);
    const samePattern = diverse.map((e) => ({ ...e, answer: `The defect in this code is: ${e.answer}` }));
    expect(issuesOf({ ...GOOD, examples: samePattern }, "examples-count-variety")).toHaveLength(1);
    expect(issuesOf({ ...GOOD, technique: "few-shot-cot", examples: diverse }, "examples-count-variety")).toEqual([]);
  });

  it("no-length-guidance: free-form output without a length", () => {
    expect(issuesOf({ ...GOOD, outputFormat: "Markdown list" }, "no-length-guidance")).toHaveLength(1);
    // Schemas bound the output themselves.
    expect(issuesOf({ ...GOOD, outputFormat: "JSON object matching the schema" }, "no-length-guidance")).toEqual([]);
  });

  it("unbounded-loop: loops need a bound, a check and (for promise loops) a marker", () => {
    const bad = { ...GOOD, task: "Keep working until all the defects are resolved." };
    const msgs = issuesOf(bad, "unbounded-loop").map((i) => i.message);
    expect(msgs).toHaveLength(2); // no bound, no check
    expect(issuesOf(bad, "unbounded-loop").every((i) => i.severity === "error")).toBe(true);

    const bounded = {
      ...GOOD,
      task: "Keep working until `npm test` exits 0, or stop after 20 turns.",
    };
    expect(issuesOf(bounded, "unbounded-loop")).toEqual([]);

    const promiseLoop = { ...bounded, technique: "completion-promise-loop" as const };
    expect(issuesOf(promiseLoop, "unbounded-loop")).toHaveLength(1); // no marker
    const withMarker = { ...promiseLoop, constraints: `${GOOD.constraints}\nOutput <promise>DONE</promise> only when every test passes.` };
    expect(issuesOf(withMarker, "unbounded-loop")).toEqual([]);
  });
});

describe("lintPrompt: low noise", () => {
  it("long-input-after-query stays quiet on the builder's own layout", () => {
    const doc = "Log line with details about the request handling. ".repeat(1700);
    expect(issuesOf({ ...GOOD, context: doc }, "long-input-after-query", OPUS_55)).toEqual([]);
  });

  it("a temperature in the task's domain is not a sampling setting", () => {
    const weather = { ...GOOD, constraints: `${GOOD.constraints}\nWarn when the temperature of 25 degrees is exceeded.` };
    expect(issuesOf(weather, "unsupported-request-params", OPUS_55)).toEqual([]);
    const sentenceEnd = { ...GOOD, constraints: `${GOOD.constraints}\nCall the API with temperature 0.2.` };
    expect(issuesOf(sentenceEnd, "unsupported-request-params", OPUS_55)).toHaveLength(1);
    const topP = { ...GOOD, constraints: `${GOOD.constraints}\nUse top_p 0.9 for variety.` };
    expect(issuesOf(topP, "unsupported-request-params", OPUS_55)).toHaveLength(1);
  });

  it("rule-without-reason ignores 'only' in compounds", () => {
    const data = {
      ...GOOD,
      constraints: "A syntax-only check does not count.\nKeep the review read-only.\nNot only bugs but also gaps matter.",
    };
    expect(issuesOf(data, "rule-without-reason")).toEqual([]);
  });

  it("vague-wording ignores quoted bad examples and comparisons", () => {
    const data = {
      ...GOOD,
      constraints: `${GOOD.constraints}\nWrite checkable rules, e.g. 'Use 2-space indentation' rather than 'Format code properly'. If a better approach exists, say so.`,
    };
    expect(lint(data).issues.map((i) => i.ruleId)).not.toContain("vague-wording");
  });

  it("build and fix verbs outside code don't make a coding prompt", () => {
    const instructions = "Help the marketing team prepare the spring launch, so the plan is ready for Monday's meeting.";
    for (const task of ["Build a marketing plan for the spring launch.", "Fix the grammar in this email and write a friendlier version."]) {
      const ids = lint({ ...GOOD, instructions, task }).issues.map((i) => i.ruleId);
      expect(ids, task).not.toContain("missing-definition-of-done");
      expect(ids, task).not.toContain("agentic-missing-verification");
    }
  });

  it("an interview-then-spec prompt is not an agentic coding run", () => {
    const data = { ...GOOD, technique: "interview-then-spec" as const, instructions: "I want to build a CLI for invoices. Interview me, then write SPEC.md." };
    const ids = lint(data).issues.map((i) => i.ruleId);
    expect(ids).not.toContain("agentic-missing-verification");
    expect(ids).not.toContain("missing-definition-of-done");
  });

  it("xml-unbalanced counts only the builder's structure tags", () => {
    const data = {
      ...GOOD,
      context: 'Error output:\n<pasted_content id="x">\nboom\n</pasted_content id="x">',
      instructions: `${GOOD.instructions} Output <promise>DONE</promise> when done; returns Vec<String>; answer in <answer> tags.`,
    };
    expect(lint(data).issues.map((i) => i.ruleId)).not.toContain("xml-unbalanced");
    const broken = buildXml(GOOD).replace("</task>", "");
    expect(lintPrompt(GOOD, broken).issues.map((i) => i.ruleId)).toContain("xml-unbalanced");
  });
});

describe("getModelProfile", () => {
  it("reads versions through provider prefixes and suffixes", () => {
    expect(getModelProfile("claude", "claude-opus-5-5[1m]")).toMatchObject({ version: 505, reasoningExtractionRisk: true });
    expect(getModelProfile("bedrock", "us.anthropic.claude-sonnet-5-5-v1:0")).toMatchObject({ version: 505, family: "claude5" });
    expect(getModelProfile("vertex", "claude-opus-5-5@20260901").label).toBe("Claude Opus 5.5");
    expect(getModelProfile("claude", "claude-opus-4-1-20250805")).toMatchObject({ version: 401, rejectsPrefill: false });
    expect(getModelProfile("claude", "claude-3-5-sonnet-20241022")).toMatchObject({ version: 305, adaptiveThinking: false });
  });

  it("treats Claude aliases as current models and other providers by name", () => {
    expect(getModelProfile("claude", "opus")).toMatchObject({ family: "claude5", line: "opus", rejectsSampling: true });
    expect(getModelProfile("openai", "gpt-4o")).toMatchObject({ family: "other", adaptiveThinking: false, rejectsPrefill: false });
    expect(getModelProfile("openai", "o4-mini").adaptiveThinking).toBe(true);
  });
});

describe("lintPrompt: scoring", () => {
  it("errors cost more than warnings, and the score stays within 0–100", () => {
    const empty: PromptStructured = { ...GOOD, instructions: "", task: "", context: "", constraints: "", outputFormat: "", targetAudience: "" };
    const r = lint(empty, OPUS_55);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThan(60);
    expect(r.issues.some((i) => i.severity === "error")).toBe(true);
    expect(lint(GOOD, OPUS_55).score).toBe(100);
  });

  it("flags unbalanced XML", () => {
    const ids = lintPrompt(GOOD, "<instructions>open but never closed", OPUS_55).issues.map((i) => i.ruleId);
    expect(ids).toContain("xml-unbalanced");
  });
});
