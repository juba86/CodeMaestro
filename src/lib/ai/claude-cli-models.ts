// Models offered for Claude Code (login/CLI mode). Empty id = Claude Code's
// default model. The CLI accepts the short aliases (always the latest model of
// that line) as well as full model ids — the pinned ids below are the current
// generation. Pure data: shared by the server provider and the session pickers.
export const CLAUDE_CLI_MODELS: readonly { id: string; name: string }[] = [
  { id: "", name: "Standard (CLI-Default)" },
  { id: "opus", name: "Claude Opus (neueste)" },
  { id: "sonnet", name: "Claude Sonnet (neueste)" },
  { id: "haiku", name: "Claude Haiku (neueste)" },
  { id: "fable", name: "Claude Fable (neueste)" },
  { id: "claude-opus-5-5", name: "Claude Opus 5.5" },
  { id: "claude-fable-5-1", name: "Claude Fable 5.1" },
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
  { id: "claude-haiku-5-5", name: "Claude Haiku 5.5" },
];

/** The offered models, plus `current` when it is a model outside the list. */
export function claudeCliModelsWith(current: string): { id: string; name: string }[] {
  return CLAUDE_CLI_MODELS.some((m) => m.id === current) ? [...CLAUDE_CLI_MODELS] : [...CLAUDE_CLI_MODELS, { id: current, name: current }];
}
