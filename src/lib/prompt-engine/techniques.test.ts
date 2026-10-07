import { describe, expect, it } from "vitest";
import type { PromptStructured, PromptTechnique } from "@/lib/ai/types";
import { buildGeneratorSystemPrompt } from "./cot-generator";
import { getModelProfile } from "./model-profile";
import { lintPrompt } from "./prompt-linter";
import { recommendTechniques, techniques } from "./techniques";
import { buildXml } from "./xml-builder";
import { PROMPT_TAGS, parseXml } from "./xml-parser";
import { builtInTemplates } from "@/lib/templates/built-in";

// Exhaustive over the PromptTechnique union: a technique added to (or removed
// from) the type without updating this map fails type-checking.
const ALL_IDS: Record<PromptTechnique, true> = {
  "chain-of-thought": true,
  "zero-shot-cot": true,
  "few-shot-cot": true,
  "self-consistency": true,
  "tree-of-thoughts": true,
  react: true,
  "self-refine": true,
  "role-prompting": true,
  "structured-output": true,
  "meta-prompting": true,
  constitutional: true,
  "step-back": true,
  analogical: true,
  decomposition: true,
  "verification-loop": true,
  "explore-plan-code-commit": true,
  "evaluator-optimizer": true,
  "completion-promise-loop": true,
  "definition-of-done": true,
  "context-engineering": true,
  "long-context-grounding": true,
  "subagent-orchestration": true,
  "interview-then-spec": true,
  "scoped-autonomy": true,
};

const OPUS_55 = getModelProfile("claude", "claude-opus-5-5");
const GPT_4O = getModelProfile("openai", "gpt-4o");

describe("technique catalog", () => {
  it("has unique ids and names", () => {
    const ids = techniques.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    const names = techniques.map((t) => t.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it("covers every PromptTechnique exactly once", () => {
    expect(techniques.map((t) => t.id).sort()).toEqual(Object.keys(ALL_IDS).sort());
  });

  it.each(techniques.map((t) => [t.id, t]))("%s is complete", (_id, t) => {
    expect(t.name.trim()).not.toBe("");
    expect(t.description.trim().length).toBeGreaterThan(20);
    expect(t.accuracyGain.trim()).not.toBe("");
    expect(t.bestFor.length).toBeGreaterThan(0);
    expect(["low", "medium", "high"]).toContain(t.complexity);
    expect(["reasoning", "agentic", "structure", "quality"]).toContain(t.category);
    expect(t.keywords.length).toBeGreaterThan(0);
    for (const kw of t.keywords) expect(kw).toBe(kw.toLowerCase());
    expect(() => new URL(t.sourceUrl)).not.toThrow();
    expect(t.sourceUrl).toMatch(/^https:\/\//);
  });

  it.each(techniques.map((t) => [t.id, t.promptSnippet]))("%s has a usable snippet", (id, snippet) => {
    expect(snippet.trim().length).toBeGreaterThan(40);
    // Placeholders are {{UPPER_CASE}} so the UI can tell users what to fill in.
    for (const m of snippet.matchAll(/\{\{([^}]*)\}\}/g)) expect(m[1]).toMatch(/^[A-Z][A-Z0-9_]*$/);
    // Snippet tags must not reuse a builder section name, which the parser
    // would read as the real section (the few-shot block is the builder's own
    // <examples> section).
    const tags = new Set([...snippet.matchAll(/<\/?([a-zA-Z][\w-]*)/g)].map((m) => m[1].toLowerCase()));
    const clashes = PROMPT_TAGS.filter((tag) => tags.has(tag));
    expect(clashes).toEqual(id === "few-shot-cot" ? ["examples"] : []);
  });

  it("the few-shot snippet parses into example scaffolds with a method", () => {
    const fewShot = techniques.find((t) => t.id === "few-shot-cot")!;
    const examples = parseXml(fewShot.promptSnippet).examples;
    expect(examples.length).toBeGreaterThanOrEqual(2);
    expect(examples.some((e) => e.thinking)).toBe(true);
  });

  it("current snippets don't trip the Claude 5 rules they are meant to avoid", () => {
    const base: PromptStructured = {
      instructions: "Review the attached diff and list behavior-changing defects for the maintainers.",
      context: "TypeScript service.",
      constraints: "Quote the affected line for each finding so reviewers can locate it.",
      examples: [],
      task: "Review the diff.",
      targetAudience: "Maintainers",
      outputFormat: "At most 10 bullets.",
    };
    const avoided = ["reasoning-extraction-risk", "obsolete-think-step-by-step", "emphasis-overload", "unsupported-request-params"];
    for (const t of techniques.filter((x) => !x.legacy)) {
      const data = { ...base, instructions: `${base.instructions}\n\n${t.promptSnippet}` };
      const hits = lintPrompt(data, buildXml(data), OPUS_55).issues.filter((i) => avoided.includes(i.ruleId));
      expect(hits.map((i) => i.ruleId), t.id).toEqual([]);
    }
  });

  it("built-in templates pass their own linter for every target", () => {
    for (const t of builtInTemplates) {
      for (const target of [undefined, OPUS_55, GPT_4O, getModelProfile("claude", "claude-sonnet-5-5")]) {
        const issues = lintPrompt(parseXml(t.content), t.content, target).issues;
        expect(issues.map((i) => `${i.severity}:${i.ruleId}`), `${t.slug} (${target?.label ?? "no target"})`).toEqual([]);
      }
    }
  });

  it("only reasoning techniques are marked legacy", () => {
    const legacy = techniques.filter((t) => t.legacy);
    expect(legacy.length).toBeGreaterThan(0);
    for (const t of legacy) expect(t.category).toBe("reasoning");
  });
});

describe("generator guidance", () => {
  it.each(techniques.map((t) => [t.id, t]))("%s has guidance and its snippet in the generator prompt", (_id, t) => {
    for (const target of [OPUS_55, GPT_4O]) {
      const base = buildGeneratorSystemPrompt(undefined, target);
      const withTechnique = buildGeneratorSystemPrompt(t.id, target);
      expect(withTechnique.startsWith(base)).toBe(true);
      const added = withTechnique.slice(base.length);
      expect(added).toContain(t.name);
      // A legacy snippet is left out for models with built-in thinking, which
      // the guidance tells to do without it.
      const showsSnippet = !(t.legacy && target.adaptiveThinking);
      if (showsSnippet) expect(added).toContain(t.promptSnippet);
      else expect(added).not.toContain(t.promptSnippet);
      // Guidance text beyond the name and snippet boilerplate.
      expect(added.length - (showsSnippet ? t.promptSnippet.length : 0) - t.name.length).toBeGreaterThan(150);
      expect(added).not.toMatch(/\bundefined\b|=>/);
    }
  });

  it("the generator prompt never asks for visible reasoning or prefill", () => {
    for (const t of [undefined, ...techniques.map((x) => x.id)]) {
      // Quoted words are examples of what to avoid, not emphasis.
      const prompt = buildGeneratorSystemPrompt(t, OPUS_55).replace(/"[^"\n]*"/g, "");
      expect(prompt).not.toMatch(/<thinking>|<scratchpad>|step[- ]by[- ]step thinking|\b(CRITICAL|MUST|NEVER|ALWAYS)\b/);
    }
  });
});

describe("recommendTechniques", () => {
  const tasks = [
    "Implement the password reset endpoint and fix the failing tests",
    "Solve this math proof about prime numbers",
    "Summarize the quarterly report for the board",
    "Review the pull request for security issues",
    "Run overnight in a loop until the backlog is done",
    "Think step by step about the logic puzzle",
  ];

  it("returns at most five distinct techniques", () => {
    for (const task of tasks) {
      const ids = recommendTechniques(task, false, false, false, OPUS_55).map((t) => t.id);
      expect(ids.length).toBeLessThanOrEqual(5);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("recommends only techniques the task gives a reason for", () => {
    // No signal: no ranking by catalog order dressed up as a recommendation.
    expect(recommendTechniques("Write a blog post about our release", false, false, false, OPUS_55)).toEqual([]);
    // A classification is not a code change, even when its labels are "bug" and "feature".
    const classify = recommendTechniques("Classify support emails as billing, bug or feature request", false, false, false, OPUS_55);
    expect(classify.map((t) => t.id).slice(0, 2).sort()).toEqual(["few-shot-cot", "structured-output"]);
    expect(recommendTechniques("Write a CLAUDE.md for this repository", false, false, false, OPUS_55)[0].id).toBe(
      "context-engineering"
    );
  });

  it("never ranks a legacy technique first for adaptive-thinking models", () => {
    for (const task of tasks) {
      expect(recommendTechniques(task, false, false, false, OPUS_55)[0]?.legacy, task).toBeFalsy();
    }
    // Without built-in thinking, manual chain-of-thought is still the right call.
    expect(recommendTechniques(tasks[1], false, false, false, GPT_4O)[0]?.id).toBe("chain-of-thought");
  });

  it("sends agentic coding to a verification loop first", () => {
    const top = recommendTechniques(tasks[0], false, false, false, OPUS_55).map((t) => t.id);
    expect(top[0]).toBe("verification-loop");
    expect(top).toContain("explore-plan-code-commit");
  });

  it("recommends the loop protocol for loop work and subagents for swarms", () => {
    expect(recommendTechniques(tasks[4], false, false, false, OPUS_55).map((t) => t.id)).toContain("completion-promise-loop");
    expect(recommendTechniques("Audit the services", false, true, false, OPUS_55).map((t) => t.id)).toContain(
      "subagent-orchestration"
    );
  });

  it("recommends few-shot when examples exist and grounding for long inputs", () => {
    expect(recommendTechniques("Classify support tickets", true, false, false, OPUS_55).map((t) => t.id)).toContain("few-shot-cot");
    const long = `Answer questions about this contract. ${"Clause text. ".repeat(8000)}`;
    expect(recommendTechniques(long, false, false, false, OPUS_55).map((t) => t.id)).toContain("long-context-grounding");
  });
});

describe("technique ↔ XML", () => {
  it("a technique survives buildXml → parseXml", () => {
    for (const t of techniques) {
      expect(parseXml(buildXml({ ...parseXml(""), instructions: "x", technique: t.id })).technique).toBe(t.id);
    }
  });

  it("prompts saved under earlier technique names keep their technique", () => {
    for (const t of techniques) {
      for (const alias of t.aliases ?? []) {
        const xml = `<instructions>x</instructions>\n\n<technique>${alias} — saved with an older version</technique>`;
        expect(parseXml(xml).technique, alias).toBe(t.id);
      }
    }
  });
});
