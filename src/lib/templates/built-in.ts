export interface BuiltInTemplate {
  slug: string;
  name: string;
  description: string;
  category: string;
  content: string;
  structured: string;
}

export const builtInTemplates: BuiltInTemplate[] = [
  {
    slug: "code-review",
    name: "Code Review",
    description: "Systematic code review with security, performance, and best practices analysis",
    category: "development",
    content: `<instructions>Perform a thorough code review focusing on correctness, security, performance, and maintainability. Use chain-of-thought reasoning to explain each finding.</instructions>

<context>{{CONTEXT}}</context>

<constraints>
- Focus on actionable findings, not style preferences
- Rate severity: critical, warning, info
- Suggest specific fixes, not vague improvements
</constraints>

<examples>
  <example>
    <input>Review this function for issues</input>
    <thinking>
Step 1: Check for correctness - does it handle edge cases?
Step 2: Check for security - any injection or auth issues?
Step 3: Check for performance - any N+1 queries or unnecessary work?
Step 4: Check for maintainability - naming, structure, complexity
    </thinking>
    <answer>Found 2 issues: [detailed findings with fixes]</answer>
  </example>
</examples>

<task>{{GOAL}}</task>`,
    structured: JSON.stringify({
      instructions: "Perform a thorough code review focusing on correctness, security, performance, and maintainability.",
      context: "{{CONTEXT}}",
      constraints: "Focus on actionable findings. Rate severity: critical, warning, info. Suggest specific fixes.",
      task: "{{GOAL}}",
      targetAudience: "Developers",
      outputFormat: "Markdown with severity ratings",
      examples: [],
    }),
  },
  {
    slug: "debugging",
    name: "Debugging Assistant",
    description: "Systematic debugging with root cause analysis and fix suggestions",
    category: "development",
    content: `<instructions>Debug the described issue using systematic root cause analysis. Think through potential causes step by step before suggesting solutions.</instructions>

<context>{{CONTEXT}}</context>

<constraints>
- Always identify root cause before suggesting fixes
- Consider both obvious and subtle causes
- Provide testable hypotheses
- Include verification steps
</constraints>

<examples>
  <example>
    <input>Application crashes on startup with "Cannot read property 'map' of undefined"</input>
    <thinking>
Step 1: The error suggests accessing .map on an undefined value
Step 2: This typically happens when data fetching returns null/undefined
Step 3: Check if the initial state or API response handles empty states
Step 4: Look for race conditions between render and data loading
    </thinking>
    <answer>Root cause: Missing null check on API response. Fix: Add optional chaining and loading state.</answer>
  </example>
</examples>

<task>{{GOAL}}</task>`,
    structured: JSON.stringify({
      instructions: "Debug the described issue using systematic root cause analysis.",
      context: "{{CONTEXT}}",
      constraints: "Always identify root cause before suggesting fixes. Provide testable hypotheses.",
      task: "{{GOAL}}",
      targetAudience: "Developers",
      outputFormat: "Root cause analysis + fix",
      examples: [],
    }),
  },
  {
    slug: "feature-design",
    name: "Feature Design",
    description: "Design a new feature with architecture, API, and implementation plan",
    category: "architecture",
    content: `<instructions>Design a comprehensive implementation plan for the described feature. Consider architecture, data model, API design, and edge cases.</instructions>

<context>{{CONTEXT}}</context>

<constraints>
- Keep it pragmatic and implementable
- Consider backward compatibility
- Identify risks and mitigations
- Break into deliverable phases
</constraints>

<examples>
  <example>
    <input>Design a notification system for a SaaS app</input>
    <thinking>
Step 1: Identify notification types (in-app, email, push)
Step 2: Design data model (Notification, NotificationPreference, Channel)
Step 3: Design API endpoints (CRUD + mark-read + preferences)
Step 4: Consider scalability (queue-based delivery, batching)
Step 5: Plan implementation phases
    </thinking>
    <answer>3-phase plan with data model, API spec, and delivery architecture</answer>
  </example>
</examples>

<task>{{GOAL}}</task>`,
    structured: JSON.stringify({
      instructions: "Design a comprehensive implementation plan for the described feature.",
      context: "{{CONTEXT}}",
      constraints: "Keep it pragmatic. Consider backward compatibility. Break into phases.",
      task: "{{GOAL}}",
      targetAudience: "Engineering team",
      outputFormat: "Design document with phases",
      examples: [],
    }),
  },
  {
    slug: "api-design",
    name: "API Design",
    description: "Design RESTful or GraphQL APIs with endpoints, schemas, and error handling",
    category: "architecture",
    content: `<instructions>Design a complete API specification for the described functionality. Include endpoints, request/response schemas, error handling, and authentication.</instructions>

<context>{{CONTEXT}}</context>

<constraints>
- Follow REST best practices (or GraphQL if specified)
- Include proper HTTP status codes
- Design for versioning
- Consider rate limiting and pagination
</constraints>

<task>{{GOAL}}</task>`,
    structured: JSON.stringify({
      instructions: "Design a complete API specification.",
      context: "{{CONTEXT}}",
      constraints: "Follow REST best practices. Include proper status codes. Design for versioning.",
      task: "{{GOAL}}",
      targetAudience: "Backend developers",
      outputFormat: "API specification with schemas",
      examples: [],
    }),
  },
  {
    slug: "refactoring",
    name: "Refactoring Guide",
    description: "Plan and execute code refactoring with safety checks",
    category: "development",
    content: `<instructions>Analyze the code and create a safe refactoring plan. Identify code smells, propose improvements, and ensure no behavior changes.</instructions>

<context>{{CONTEXT}}</context>

<constraints>
- Preserve existing behavior (no functional changes)
- Each step should be independently verifiable
- Prioritize readability and maintainability
- Consider test coverage implications
</constraints>

<task>{{GOAL}}</task>`,
    structured: JSON.stringify({
      instructions: "Analyze code and create a safe refactoring plan.",
      context: "{{CONTEXT}}",
      constraints: "Preserve behavior. Each step independently verifiable.",
      task: "{{GOAL}}",
      targetAudience: "Developers",
      outputFormat: "Step-by-step refactoring plan",
      examples: [],
    }),
  },
  {
    slug: "test-generation",
    name: "Test Generation",
    description: "Generate comprehensive test suites with edge cases and mocks",
    category: "development",
    content: `<instructions>Generate a comprehensive test suite for the described code. Include unit tests, edge cases, error scenarios, and integration tests where appropriate.</instructions>

<context>{{CONTEXT}}</context>

<constraints>
- Cover happy path, edge cases, and error scenarios
- Use appropriate mocking strategies
- Follow AAA pattern (Arrange, Act, Assert)
- Aim for meaningful coverage, not 100%
</constraints>

<task>{{GOAL}}</task>`,
    structured: JSON.stringify({
      instructions: "Generate a comprehensive test suite.",
      context: "{{CONTEXT}}",
      constraints: "Cover happy path, edge cases, errors. Follow AAA pattern.",
      task: "{{GOAL}}",
      targetAudience: "Developers",
      outputFormat: "Test code with descriptions",
      examples: [],
    }),
  },
  {
    slug: "swarm-orchestration",
    name: "Swarm Orchestration (ruflo)",
    description: "Configure multi-agent swarm for complex AI tasks using ruflo patterns",
    category: "ai-agents",
    content: `<instructions>Design a multi-agent swarm orchestration configuration for the described task. Define agent roles, topology, coordination strategy, and task routing.</instructions>

<context>{{CONTEXT}}</context>

<constraints>
- Maximum 6-8 agents to reduce coordination overhead
- Each agent must have clear, non-overlapping responsibilities
- Define escalation paths for complex decisions
- Include memory scope and sharing strategy
</constraints>

<swarm-config topology="hierarchical" coordination="weighted" memory="project">
  <agents count="{{AGENT_COUNT}}">
    <agent type="architect" name="Strategic Queen">High-level planning and task decomposition</agent>
    <agent type="researcher" name="Researcher">Information gathering and analysis</agent>
    <agent type="coder" name="Coder">Implementation and code generation</agent>
    <agent type="reviewer" name="Reviewer">Quality assurance and code review</agent>
    <agent type="tester" name="Tester">Test generation and validation</agent>
  </agents>
</swarm-config>

<examples>
  <example>
    <input>Set up a swarm for a full-stack feature implementation</input>
    <thinking>
Step 1: Identify required capabilities - design, frontend, backend, testing
Step 2: Choose topology - hierarchical for clear task flow
Step 3: Assign roles - Architect (queen), 2 Coders (frontend/backend), Tester, Reviewer
Step 4: Define coordination - weighted voting with queen having 3x weight
Step 5: Set memory scope - project-level for shared context
    </thinking>
    <answer>5-agent hierarchical swarm with weighted coordination</answer>
  </example>
</examples>

<task>{{GOAL}}</task>`,
    structured: JSON.stringify({
      instructions: "Design a multi-agent swarm orchestration configuration.",
      context: "{{CONTEXT}}",
      constraints: "Max 6-8 agents. Clear, non-overlapping responsibilities. Define escalation paths.",
      task: "{{GOAL}}",
      targetAudience: "AI developers using ruflo",
      outputFormat: "Swarm configuration with XML tags",
      examples: [],
      swarmConfig: {
        topology: "hierarchical",
        agentCount: 5,
        agentRoles: [
          { type: "architect", name: "Strategic Queen", description: "High-level planning" },
          { type: "researcher", name: "Researcher", description: "Information gathering" },
          { type: "coder", name: "Coder", description: "Implementation" },
          { type: "reviewer", name: "Reviewer", description: "Quality assurance" },
          { type: "tester", name: "Tester", description: "Test generation" },
        ],
        coordinationStrategy: "weighted",
        memoryScope: "project",
      },
    }),
  },
  {
    slug: "swarm-task-routing",
    name: "Swarm Task Routing",
    description: "Configure intelligent task routing for multi-agent systems with complexity-based dispatch",
    category: "ai-agents",
    content: `<instructions>Design a task routing configuration for a multi-agent swarm. Define complexity tiers, model selection, and agent dispatch rules based on ruflo patterns.</instructions>

<context>{{CONTEXT}}</context>

<constraints>
- Define 3 complexity tiers: simple (transforms), medium (logic), complex (architecture)
- Map each tier to appropriate model/agent combination
- Include cost optimization through intelligent routing
- Define fallback and escalation paths
</constraints>

<swarm-config topology="star" coordination="majority" memory="project">
  <agents count="{{AGENT_COUNT}}">
    <agent type="optimizer" name="Task Router">Analyzes incoming tasks and routes to appropriate tier</agent>
    <agent type="coder" name="Fast Worker">Handles simple transformations via Agent Booster</agent>
    <agent type="coder" name="Standard Worker">Handles medium complexity with Haiku/Sonnet</agent>
    <agent type="architect" name="Complex Worker">Handles architecture-level tasks with Opus</agent>
  </agents>
</swarm-config>

<task>{{GOAL}}</task>`,
    structured: JSON.stringify({
      instructions: "Design a task routing configuration for a multi-agent swarm.",
      context: "{{CONTEXT}}",
      constraints: "3 complexity tiers. Cost optimization. Fallback paths.",
      task: "{{GOAL}}",
      targetAudience: "AI developers using ruflo",
      outputFormat: "Routing configuration with tiers",
      examples: [],
      swarmConfig: {
        topology: "star",
        agentCount: 4,
        agentRoles: [
          { type: "optimizer", name: "Task Router", description: "Routes tasks by complexity" },
          { type: "coder", name: "Fast Worker", description: "Simple transforms" },
          { type: "coder", name: "Standard Worker", description: "Medium complexity" },
          { type: "architect", name: "Complex Worker", description: "Architecture tasks" },
        ],
        coordinationStrategy: "majority",
        memoryScope: "project",
      },
    }),
  },
  {
    slug: "tree-of-thoughts",
    name: "Tree of Thoughts (ToT)",
    description: "Explore multiple reasoning paths with evaluation and backtracking for complex decisions",
    category: "techniques",
    content: `<instructions>Solve this problem using Tree of Thoughts. Explore multiple reasoning branches at each step, evaluate each, and backtrack from dead ends.</instructions>

<context>{{CONTEXT}}</context>

<constraints>
- Generate 2-3 candidate approaches at each decision point
- Evaluate each branch as: promising, unlikely, or dead_end
- Backtrack if a path leads to contradiction or impossibility
- Select the best path through the reasoning tree
</constraints>

<examples>
  <example>
    <input>Design the optimal architecture for a real-time dashboard</input>
    <thinking>
Branch A: Server-Sent Events (SSE)
  Evaluation: promising - simple, good browser support
  Sub-branch A1: SSE + Redis pub/sub -> promising
  Sub-branch A2: SSE + polling fallback -> promising

Branch B: WebSockets
  Evaluation: promising - bidirectional, lower latency
  Sub-branch B1: WebSocket + Socket.io -> promising (handles reconnection)
  Sub-branch B2: Raw WebSocket -> dead_end (too much reconnection logic)

Branch C: Long Polling
  Evaluation: unlikely - high server load at scale

Selected: Branch A1 (SSE + Redis) for unidirectional data, with WebSocket fallback for bidirectional needs
    </thinking>
    <answer>Hybrid SSE + WebSocket architecture with Redis pub/sub</answer>
  </example>
</examples>

<task>{{GOAL}}</task>`,
    structured: JSON.stringify({
      instructions: "Solve using Tree of Thoughts: explore branches, evaluate, backtrack.",
      context: "{{CONTEXT}}",
      constraints: "Generate 2-3 candidate approaches. Evaluate as promising/unlikely/dead_end. Backtrack from dead ends.",
      task: "{{GOAL}}",
      targetAudience: "Developers and architects",
      outputFormat: "Reasoning tree with selected path",
      examples: [],
      technique: "tree-of-thoughts",
    }),
  },
  {
    slug: "react-agent",
    name: "ReAct (Reasoning + Acting)",
    description: "Interleave reasoning with tool actions for agentic workflows",
    category: "techniques",
    content: `<instructions>Solve this task using the ReAct pattern: alternate between Thought (reasoning), Action (tool use), and Observation (results) until you have enough information for a final answer.</instructions>

<context>{{CONTEXT}}</context>

<constraints>
- Always think before acting
- Each action should be purposeful and advance toward the goal
- Reflect on observations before deciding the next step
- Stop when you have enough information for a confident answer
</constraints>

<examples>
  <example>
    <input>Find and fix the performance bottleneck in the user dashboard</input>
    <thinking>
Thought 1: I need to identify where the slowdown occurs. Let me check the network requests.
Action 1: [read_file] src/pages/dashboard.tsx
Observation 1: Component fetches 5 API endpoints sequentially on mount

Thought 2: Sequential fetching is likely the bottleneck. Let me check if these can be parallelized.
Action 2: [search_code] "await fetch" in dashboard
Observation 2: All 5 fetches are independent - no data dependencies between them

Thought 3: These can be parallelized with Promise.all. Let me also check for unnecessary re-renders.
Action 3: [run_profiler] React DevTools profiler on dashboard
Observation 3: UserList component re-renders 12 times due to missing memoization
    </thinking>
    <answer>Two fixes: 1) Parallelize API calls with Promise.all, 2) Memoize UserList with React.memo</answer>
  </example>
</examples>

<task>{{GOAL}}</task>`,
    structured: JSON.stringify({
      instructions: "Use ReAct pattern: Thought -> Action -> Observation cycles.",
      context: "{{CONTEXT}}",
      constraints: "Think before acting. Reflect on observations. Stop when confident.",
      task: "{{GOAL}}",
      targetAudience: "AI agents and developers",
      outputFormat: "ReAct trajectory with final answer",
      examples: [],
      technique: "react",
    }),
  },
  {
    slug: "self-refine",
    name: "Self-Refine (Iterative)",
    description: "Generate, critique, and improve in iterative cycles for quality-critical outputs",
    category: "techniques",
    content: `<instructions>Use the Self-Refine technique: generate an initial output, critique it against quality criteria, then produce an improved version. Repeat until criteria are met.</instructions>

<context>{{CONTEXT}}</context>

<quality-criteria>
- Correctness: handles all edge cases
- Clarity: readable and well-structured
- Completeness: addresses all requirements
- Efficiency: optimal approach without over-engineering
</quality-criteria>

<constraints>
- Maximum 3 refinement iterations
- Each critique must identify specific, actionable improvements
- Stop early if all quality criteria are met
</constraints>

<examples>
  <example>
    <input>Write a retry mechanism with exponential backoff</input>
    <thinking>
ITERATION 1 - Generate:
async function retry(fn, maxRetries = 3) {
  for (let i = 0; i &lt; maxRetries; i++) {
    try { return await fn(); }
    catch (e) { await sleep(Math.pow(2, i) * 1000); }
  }
}

ITERATION 1 - Critique:
- Missing: no jitter (thundering herd problem)
- Missing: no error propagation on final failure
- Missing: no configurable base delay

ITERATION 2 - Refine:
Added jitter, final error throw, configurable options. All criteria met.
    </thinking>
    <answer>Production-ready retry with backoff, jitter, and configuration</answer>
  </example>
</examples>

<task>{{GOAL}}</task>`,
    structured: JSON.stringify({
      instructions: "Use Self-Refine: generate, critique against criteria, improve iteratively.",
      context: "{{CONTEXT}}",
      constraints: "Max 3 iterations. Specific critiques. Stop when criteria met.",
      task: "{{GOAL}}",
      targetAudience: "Developers",
      outputFormat: "Iterative improvement with final output",
      examples: [],
      technique: "self-refine",
    }),
  },
  {
    slug: "step-back-prompting",
    name: "Step-Back Prompting",
    description: "Consider abstract principles first, then apply to the specific problem (7-27% gain over CoT)",
    category: "techniques",
    content: `<instructions>Use Step-Back Prompting: first identify the abstract principles and domain knowledge relevant to this problem, then use those principles to reason about the specific question.</instructions>

<context>{{CONTEXT}}</context>

<constraints>
- Always formulate and answer the step-back question first
- Ground your specific reasoning in the abstract principles
- Make the connection between principles and specifics explicit
</constraints>

<examples>
  <example>
    <input>Why does our React app re-render the entire list when one item changes?</input>
    <thinking>
STEP BACK - Abstract principles:
Q: How does React's reconciliation algorithm decide what to re-render?
A: React uses a virtual DOM diffing algorithm. Components re-render when: (1) their state changes, (2) their props change, or (3) their parent re-renders. React compares by reference, not deep equality. Lists need stable keys for efficient diffing.

GROUNDED REASONING:
Applying these principles to the specific case:
1. If the list is stored as state in the parent, any item change creates a new array reference
2. Without React.memo, all child components re-render when parent re-renders
3. Without stable keys, React cannot optimize which items to skip
    </thinking>
    <answer>Three fixes: use React.memo on list items, ensure stable keys, consider virtualization for large lists</answer>
  </example>
</examples>

<task>{{GOAL}}</task>`,
    structured: JSON.stringify({
      instructions: "Step-Back: identify abstract principles first, then apply to specific question.",
      context: "{{CONTEXT}}",
      constraints: "Formulate step-back question first. Ground reasoning in principles.",
      task: "{{GOAL}}",
      targetAudience: "Developers and engineers",
      outputFormat: "Abstract principles + grounded reasoning",
      examples: [],
      technique: "step-back",
    }),
  },
  {
    slug: "decomposition",
    name: "Task Decomposition",
    description: "Break complex tasks into independent sub-tasks with dependency tracking",
    category: "techniques",
    content: `<instructions>Decompose this complex task into smaller, independent sub-tasks. Define dependencies between them, solve each, then combine results.</instructions>

<context>{{CONTEXT}}</context>

<constraints>
- Each sub-task should be simple enough to solve reliably in isolation
- Identify which sub-tasks can run in parallel
- Define clear inputs/outputs for each sub-task
- Track dependencies explicitly
</constraints>

<examples>
  <example>
    <input>Add user authentication to the application</input>
    <thinking>
Subtask 1 (no deps): Design auth schema (users table, sessions)
Subtask 2 (no deps): Research and select JWT library
Subtask 3 (deps: 1,2): Implement signup/login API endpoints
Subtask 4 (deps: 3): Create auth middleware
Subtask 5 (deps: 3): Build login/signup UI forms
Subtask 6 (deps: 4,5): Integration testing

Parallel groups:
  [1, 2] can run simultaneously
  [4, 5] can run simultaneously after 3
    </thinking>
    <answer>6 subtasks with 2 parallel execution groups, estimated 3 sequential phases</answer>
  </example>
</examples>

<task>{{GOAL}}</task>`,
    structured: JSON.stringify({
      instructions: "Decompose into sub-tasks with dependency tracking.",
      context: "{{CONTEXT}}",
      constraints: "Each sub-task solvable in isolation. Identify parallelism. Track dependencies.",
      task: "{{GOAL}}",
      targetAudience: "Project leads and developers",
      outputFormat: "Sub-task breakdown with dependency graph",
      examples: [],
      technique: "decomposition",
    }),
  },
  {
    slug: "constitutional-critique",
    name: "Constitutional AI / Self-Critique",
    description: "Define principles and have the AI critique and revise its output against them",
    category: "techniques",
    content: `<instructions>Generate a response, then critique it against the defined principles. Revise until all principles are satisfied.</instructions>

<context>{{CONTEXT}}</context>

<constitution>
  <principle id="1" name="accuracy">Responses must be factually accurate. Express uncertainty rather than stating guesses as facts.</principle>
  <principle id="2" name="safety">Responses must not include harmful instructions or encourage dangerous behavior.</principle>
  <principle id="3" name="completeness">Responses must address all aspects of the question.</principle>
  <principle id="4" name="actionability">Suggestions must be specific and implementable, not vague.</principle>
</constitution>

<constraints>
- Check each principle explicitly
- If any principle is violated, revise and re-check
- Maximum 2 revision rounds
</constraints>

<task>{{GOAL}}</task>`,
    structured: JSON.stringify({
      instructions: "Generate, critique against principles, revise until compliant.",
      context: "{{CONTEXT}}",
      constraints: "Check each principle. Revise if violated. Max 2 rounds.",
      task: "{{GOAL}}",
      targetAudience: "Safety-conscious applications",
      outputFormat: "Principle-checked response",
      examples: [],
      technique: "constitutional",
    }),
  },
  {
    slug: "meta-prompting",
    name: "Meta-Prompting",
    description: "Use AI to generate and optimize prompts for other tasks",
    category: "techniques",
    content: `<instructions>You are a prompt engineering expert. Generate an optimized prompt for the described task. The output should be a production-ready prompt using XML tags.</instructions>

<context>{{CONTEXT}}</context>

<target-task>
  <description>{{GOAL}}</description>
  <target-model>Claude / Gemini (selectable)</target-model>
  <desired-output>Structured, actionable output</desired-output>
</target-task>

<constraints>
- Use XML tags for clear structure
- Include 2-3 few-shot examples with Chain-of-Thought
- Optimize for accuracy and specificity
- Follow Anthropic's best practices: be specific, use examples, tell what TO DO
</constraints>

<prompt-principles>
- Place long context at top, instructions at bottom
- Use descriptive XML tag names
- Include quality criteria for self-evaluation
- Be explicit but not aggressive in tone
</prompt-principles>

<task>Generate the optimized prompt</task>`,
    structured: JSON.stringify({
      instructions: "Generate an optimized prompt for the described task.",
      context: "{{CONTEXT}}",
      constraints: "Use XML tags. Include examples. Follow Anthropic best practices.",
      task: "{{GOAL}}",
      targetAudience: "Prompt engineers and AI developers",
      outputFormat: "Complete XML prompt ready for use",
      examples: [],
      technique: "meta-prompting",
    }),
  },
];
