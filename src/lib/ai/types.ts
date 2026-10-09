// Provider ids are catalog-driven (see catalog.ts), so this is a free string.
// The dedicated providers still narrow their own `name` to a literal.
export type ProviderName = string;

export interface ModelInfo {
  id: string;
  name: string;
  provider: ProviderName;
  maxTokens: number;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface StreamChunk {
  type: "text" | "done" | "error";
  content: string;
}

export interface SendMessageParams {
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
  // Ignored by models that reject sampling params (Claude 4.7+ / 5.x).
  temperature?: number;
  systemPrompt?: string;
  // Reasoning depth for providers that support it (Claude: output_config.effort).
  // Clamped to what the model accepts; ignored elsewhere.
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  // Cancels the request (Stop): a local model then frees the GPU at once
  // instead of finishing a generation nobody reads.
  signal?: AbortSignal;
}

export interface AIProvider {
  name: ProviderName;
  sendMessage(params: SendMessageParams): Promise<string>;
  streamMessage(params: SendMessageParams): AsyncGenerator<StreamChunk>;
  getModels(): ModelInfo[];
  validateCredentials(apiKey: string): Promise<boolean>;
}

export interface SwarmConfig {
  topology: "hierarchical" | "mesh" | "ring" | "star";
  agentCount: number;
  agentRoles: SwarmAgentRole[];
  coordinationStrategy: "majority" | "weighted" | "byzantine";
  memoryScope: "project" | "local" | "user";
}

export interface SwarmAgentRole {
  type: "researcher" | "coder" | "analyst" | "tester" | "architect" | "reviewer" | "optimizer" | "documenter" | "custom";
  name: string;
  description: string;
}

export type PromptTechnique =
  | "chain-of-thought"
  | "zero-shot-cot"
  | "few-shot-cot"
  | "self-consistency"
  | "tree-of-thoughts"
  | "react"
  | "self-refine"
  | "role-prompting"
  | "structured-output"
  | "meta-prompting"
  | "constitutional"
  | "step-back"
  | "analogical"
  | "decomposition"
  | "verification-loop"
  | "explore-plan-code-commit"
  | "evaluator-optimizer"
  | "completion-promise-loop"
  | "definition-of-done"
  | "context-engineering"
  | "long-context-grounding"
  | "subagent-orchestration"
  | "interview-then-spec"
  | "scoped-autonomy";

export interface PromptStructured {
  instructions: string;
  context: string;
  constraints: string;
  examples: PromptExample[];
  task: string;
  targetAudience: string;
  outputFormat: string;
  technique?: PromptTechnique;
  swarmConfig?: SwarmConfig;
}

export interface PromptExample {
  id: string;
  input: string;
  thinking: string;
  answer: string;
}
