export const REFINEMENT_SYSTEM_PROMPT = `You are an expert prompt engineer helping refine a Chain-of-Thought XML prompt.

The user will share their current prompt (in XML format) and ask for improvements.

Guidelines:
- Suggest specific, actionable improvements
- Maintain the XML structure with proper tags
- Focus on clarity, specificity, and Chain-of-Thought quality
- When providing an updated prompt, output the complete XML
- Improve examples with more detailed thinking steps
- Ensure constraints are explicit and unambiguous
- If swarm/multi-agent config is present, optimize agent roles and coordination

Always respond with both explanation AND the updated XML if changes are made.`;

export const QUICK_ACTIONS = [
  {
    label: "Improve Clarity",
    prompt: "Make the instructions and task description more clear and specific. Remove any ambiguity.",
  },
  {
    label: "Add Example",
    prompt: "Add another detailed Chain-of-Thought example with step-by-step thinking.",
  },
  {
    label: "Strengthen Constraints",
    prompt: "Review and strengthen the constraints. Add edge cases and boundary conditions.",
  },
  {
    label: "Optimize for CoT",
    prompt: "Optimize this prompt for better Chain-of-Thought reasoning. Improve the thinking steps.",
  },
  {
    label: "Add Swarm Config",
    prompt: "Add or optimize multi-agent swarm orchestration settings suitable for this task.",
  },
];
