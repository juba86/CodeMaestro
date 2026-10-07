import type { ModelProfile } from "./model-profile";
import { PROMPT_WRITING_RULES, targetModelRules } from "./cot-generator";

/**
 * System prompt for the refinement chat. Pass the profile of the model the
 * prompt will run on to get its specific rules; without one, the rules safe
 * for current Claude models apply (they suit other models too).
 */
export function buildRefinementSystemPrompt(target?: ModelProfile): string {
  return `You are an expert prompt engineer helping a user refine a prompt written in the XML format of the CodeMaestro prompt builder. Each message contains the current prompt XML and a request.

Focus on what makes prompts work on current models: clarity, the context the model needs, success criteria, a runnable check for agentic tasks, positive phrasing, a reason for each constraint, and fit for the target model. Keep the user's intent and everything that already works; change only what the request or these rules call for.

The builder reads your reply by tag name, so keep its exact tags: <context>, <instructions>, <constraints>, <target-audience>, <output-format>, <examples> (with <example> children containing <input>, an optional <method> and <answer>), <task>, and <swarm-config> when one is present. It renders them in that order, with <context> first and <task> last. Text outside these tags is dropped, so nest anything else (documents, snippets, extra blocks) inside the section it belongs to. Older prompts may show example reasoning in <thinking> tags; write it as <method>.

Reply format:
1. A short list of the changes, one line each with the reason.
2. The complete updated prompt in a single \`\`\`xml code block, with every section that should remain, not only the changed ones, because the builder replaces the whole prompt with it.
If the request needs no change to the prompt (for example a question), answer briefly and leave out the code block.

${PROMPT_WRITING_RULES}

${targetModelRules(target)}`;
}

export const REFINEMENT_SYSTEM_PROMPT = buildRefinementSystemPrompt();

export const QUICK_ACTIONS = [
  {
    label: "Modernize for Claude 5",
    prompt:
      "Update this prompt for current Claude models. Remove 'think step by step' and 'think carefully' boilerplate, any <thinking>, <scratchpad> or 'show your reasoning' sections, reasoning or thinking fields in schemas, and any reliance on assistant prefill. Tone down ALL-CAPS, CRITICAL and MUST emphasis to normal wording, keeping at most one emphasized line. Rewrite 'don't' rules as positive instructions, and add a short reason to each hard rule. Keep the intent unchanged and list each change in one line.",
  },
  {
    label: "Add Definition of Done",
    prompt:
      "Add a definition of done: one measurable end state, the exact check that proves it (for example a test command that exits 0), and the constraints that matter. Add stop rules: keep working unless blocked on the user or before destructive actions. End the report with the headings Blocked on me, Changed, Found.",
  },
  {
    label: "Add Verification Step",
    prompt:
      "Add a verification loop. Name the concrete check the agent must run (tests, type-check, build or a screenshot comparison), tell it to iterate until the check passes by fixing root causes, forbid special-casing test inputs, and require evidence in the final report: the command and its output. Use a {{CHECK_COMMAND}} placeholder if the command is unknown.",
  },
  {
    label: "Make it a Loop",
    prompt:
      "Convert this prompt into a completion-promise loop for repeated autonomous runs. Add the state-file protocol (read the progress file, tasks JSON and git log at the start; one task per iteration; commit; append progress), an exact <promise>MARKER</promise> printed only when the completion condition is true, a BLOCKED path, a max-iterations bound, and the reversibility safety block.",
  },
  {
    label: "Explore, Plan, Code, Commit",
    prompt:
      "Restructure this prompt into four separate phases. Explore without editing. Write PLAN.md listing files, scope, tests and verification, then wait for approval. Implement with checks. Commit. Name the concrete paths to read and an existing file to use as the pattern.",
  },
  {
    label: "Add Safety Guardrails",
    prompt:
      "Add scoped-autonomy and reversibility guardrails. Deliver what was asked at the intended scope without over-engineering. Take reversible local actions freely. Ask before destructive, hard-to-reverse or externally visible actions (deleting files or branches, force-push, reset --hard, pushing, commenting). Never bypass checks with --no-verify. If the run is unattended, record those actions as blocked instead of asking.",
  },
  {
    label: "Trim to Essentials",
    prompt:
      "Apply context engineering. For each sentence, ask whether removing it would cause the model to make a mistake, and cut it if not. Replace long rule lists with one sentence of judgement plus the reason, remove contradictions and repetition, and replace pasted content with paths or commands the agent can read when needed. Report the token savings.",
  },
  {
    label: "Long-Context Layout",
    prompt:
      "Reorganize for long inputs. Move every document into the <context> section, which the builder renders first, as <documents><document index=\"n\"><source>...</source><document_content>...</document_content></document></documents>. Put the question in <task>, which the builder renders last, and add quote-first grounding: extract relevant quotes in <quotes>, answer only from them, and say so when the information is insufficient.",
  },
  {
    label: "Diversify Examples",
    prompt:
      "Review the examples. Make sure there are 3-5, each wrapped in <example> tags, that mirror real inputs, cover edge cases, and vary enough to avoid unintended patterns. Present each as input, method and answer, without <thinking> tags. Replace near-duplicates.",
  },
  {
    label: "Add Review Pass",
    prompt:
      "Add an evaluator-optimizer step. After the work passes its check, a fresh-context reviewer checks it against explicit criteria (requirements implemented, edge cases tested, nothing out of scope changed) and reports only gaps that affect correctness. The author fixes the confirmed gaps, for at most 2-3 rounds.",
  },
];
