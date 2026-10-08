// Tool allowlist entries offered by the New-Session sheet (passed to Claude Code
// as --allowedTools permission rules). Pure data, shared by the server
// (security.ts → /api/assistant/workspaces) and the client (new-session.ts).
//
// git and the GitHub CLI are offered as rule GROUPS of everyday subcommands
// (one chip each in the UI), not as "Bash(git *)" / "Bash(gh *)": those broad
// rules amount to arbitrary shell access — `git -c alias.x='!sh -c …' x`,
// `git -c core.pager=… log` and `gh alias set --shell` all run any command.
// A rule like "Bash(git status *)" only matches when the subcommand directly
// follows `git`, so global options before it (-c, -C, --exec-path) never match.
//
// HONEST LIMITS — this is a convenience, not a sandbox: git still runs code the
// repository configures (hooks on commit/checkout, filters and diff drivers,
// core.pager in .git/config), and an agent that may also Edit/Write can plant
// those; options such as `git push --receive-pack=…` or `git fetch/pull
// --upload-pack=…` run commands as well, and `git log/diff --output=<file>`
// (with a literal --format) writes any file — .git/config or a shell rc
// included — even without Edit/Write. To confirm every command, use the
// approval mode "all" (Dateiänderungen & Befehle).
//
// Sessions that stored the old broad rules keep them: the CSV is passed to the
// CLI unchanged. The UI shows them as the same chips and replaces them with the
// narrow group when toggled (see new-session.ts).

export const GIT_RULES: readonly string[] = [
  "Bash(git status *)",
  "Bash(git diff *)",
  "Bash(git log *)",
  "Bash(git add *)",
  "Bash(git commit *)",
  "Bash(git push *)",
  "Bash(git pull *)",
  "Bash(git fetch *)",
  "Bash(git switch *)",
  "Bash(git checkout *)",
  "Bash(git branch *)",
];

export const GH_RULES: readonly string[] = ["Bash(gh pr *)", "Bash(gh issue *)", "Bash(gh repo view *)"];

export type ToolGroupId = "git" | "gh";

export interface ToolGroup {
  id: ToolGroupId;
  /** The narrow rules the chip grants. */
  rules: readonly string[];
  /** The broad rule older sessions / remembered drafts may contain. */
  legacy: string;
}

export const TOOL_GROUPS: readonly ToolGroup[] = [
  { id: "git", rules: GIT_RULES, legacy: "Bash(git *)" },
  { id: "gh", rules: GH_RULES, legacy: "Bash(gh *)" },
];

/** The group a rule belongs to (its narrow rules or its legacy broad rule). */
export function toolGroupOf(rule: string): ToolGroup | undefined {
  return TOOL_GROUPS.find((g) => g.legacy === rule || g.rules.includes(rule));
}

/** Everything the allowlist UI offers, in display order. */
export const SELECTABLE_TOOLS: readonly string[] = [
  "Read", "Grep", "Glob", "Bash", ...GIT_RULES, ...GH_RULES, "Edit", "Write", "WebSearch", "WebFetch",
];
