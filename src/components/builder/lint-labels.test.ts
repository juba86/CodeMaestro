import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { lintPrompt, type LintIssue } from "@/lib/prompt-engine/prompt-linter";
import { getModelProfile } from "@/lib/prompt-engine/model-profile";
import { techniques } from "@/lib/prompt-engine/techniques";
import type { PromptStructured } from "@/lib/ai/types";
import { LINT_RULE_LABEL, describeIssue } from "./lint-labels";
import { TECHNIQUE_DE, techniqueCopy } from "./technique-labels";

const LINTER_SOURCE = readFileSync(
  fileURLToPath(new URL("../../lib/prompt-engine/prompt-linter.ts", import.meta.url)),
  "utf8",
);

const EMPTY: PromptStructured = {
  instructions: "",
  context: "",
  constraints: "",
  examples: [],
  task: "",
  targetAudience: "",
  outputFormat: "",
};

const issue = (ruleId: string, message: string, severity: LintIssue["severity"] = "warning"): LintIssue => ({
  ruleId,
  severity,
  message,
});

describe("lint labels", () => {
  it("has a German label for every rule the linter can raise", () => {
    const ids = new Set([...LINTER_SOURCE.matchAll(/add\("([a-z0-9-]+)"/g)].map((m) => m[1]));
    expect(ids.size).toBeGreaterThan(10);
    for (const id of ids) expect(LINT_RULE_LABEL[id], id).toBeDefined();
  });

  it("never exposes a rule id, even for rules it does not know", () => {
    const d = describeIssue(issue("brand-new-rule", "Something new."));
    expect(d.title).toBe("Hinweis zum Prompt");
    expect(JSON.stringify(d)).not.toContain("brand-new-rule");
    expect(d.untranslated).toBe("Something new.");
  });

  it("describes real linter output in German", () => {
    const data: PromptStructured = {
      ...EMPTY,
      instructions: "Make the code good and NEVER EVER use ALL CAPS!!! MUST do it. Think step by step.",
      constraints: "Do not use markdown. Never add comments. Always run tests.",
      outputFormat: "Don't use bullet points.",
      technique: "completion-promise-loop",
    };
    const report = lintPrompt(data, "", getModelProfile("claude", "claude-opus-5-5"));
    expect(report.issues.length).toBeGreaterThan(3);
    for (const i of report.issues) {
      const d = describeIssue(i);
      expect(d.untranslated).toBeUndefined();
      expect(d.title).not.toMatch(/[a-z]+-[a-z]+-/);
    }
  });

  it("restates dynamic details", () => {
    expect(describeIssue(issue("vague-wording", "Vague wording: good, stuff.")).detail).toBe("Gefunden: good, stuff");
    expect(
      describeIssue(issue("large-prompt", "Large prompt (~12,345 tokens).")).detail,
    ).toBe("Rund 12.345 Tokens.");
    expect(
      describeIssue(
        issue(
          "examples-count-variety",
          "The examples may be too few, too many, or too similar: only 1 example; examples 1 and 2 have nearly identical inputs.",
        ),
      ).detail,
    ).toBe("Auffällig: nur 1 Beispiel; Beispiele 1 und 2 haben fast gleiche Eingaben");
    expect(
      describeIssue(issue("missing-examples", 'Technique "few-shot-cot" works best with examples, but none are present.')).detail,
    ).toBe("Die Technik „Few-Shot-Beispiele“ wirkt am besten mit Beispielen.");
    expect(
      describeIssue(
        issue(
          "unsupported-request-params",
          "This prompt ends with an assistant turn (prefill) and sets temperature/top_p/top_k, which Claude Opus 5.5 rejects with HTTP 400.",
        ),
      ).detail,
    ).toBe(
      "Der Prompt endet mit einer Assistant-Zeile (Prefill) und setzt temperature, top_p oder top_k – Claude Opus 5.5 lehnt das mit HTTP 400 ab.",
    );
  });

  it("tells the three loop findings apart", () => {
    const titles = [
      "This loop or goal prompt has no iteration bound.",
      "This loop or goal prompt has no verifiable check.",
      "This loop prompt has no completion marker.",
    ].map((m) => describeIssue(issue("unbounded-loop", m, "error")).title);
    expect(new Set(titles).size).toBe(3);
  });
});

describe("technique labels", () => {
  it("translates every technique in the catalogue", () => {
    for (const t of techniques) {
      expect(TECHNIQUE_DE[t.id], t.id).toBeDefined();
      expect(techniqueCopy(t).translated).toBe(true);
    }
  });
});

describe("quick action labels", () => {
  it("has a German label for every refinement quick action", async () => {
    const { QUICK_ACTIONS } = await import("@/lib/prompt-engine/refinement-prompts");
    const { QUICK_ACTION_LABEL } = await import("./quick-action-labels");
    expect(QUICK_ACTIONS.length).toBeGreaterThan(5);
    for (const a of QUICK_ACTIONS) expect(QUICK_ACTION_LABEL[a.label], a.label).toBeDefined();
  });
});
