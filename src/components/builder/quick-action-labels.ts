/**
 * German labels for the refinement chat's quick actions (DESIGN.md §8). The
 * engine keys them by their English label; their prompts stay English, as
 * they are instructions for the model, sent as the user turn.
 */
export const QUICK_ACTION_LABEL: Record<string, string> = {
  "Modernize for Claude 5": "Für Claude 5 modernisieren",
  "Add Definition of Done": "Definition of Done ergänzen",
  "Add Verification Step": "Prüfung ergänzen",
  "Make it a Loop": "Als Loop umbauen",
  "Explore, Plan, Code, Commit": "Erkunden, Planen, Umsetzen, Committen",
  "Add Safety Guardrails": "Leitplanken ergänzen",
  "Trim to Essentials": "Aufs Wesentliche kürzen",
  "Long-Context Layout": "Layout für langen Kontext",
  "Diversify Examples": "Beispiele vielfältiger machen",
  "Add Review Pass": "Review-Durchgang ergänzen",
};

export function quickActionLabel(label: string): string {
  return QUICK_ACTION_LABEL[label] ?? label;
}
