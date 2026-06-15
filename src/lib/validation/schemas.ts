import { z } from "zod";

// --- Shared enums ---

// Provider ids are catalog-driven (see src/lib/ai/catalog.ts), so this is an
// open string rather than a fixed enum. Routes validate against the catalog.
const providerEnum = z.string().min(1).max(40);

// --- AI Routes ---

export const chatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        content: z.string().min(1),
      })
    )
    .min(1)
    .max(50),
  systemPrompt: z.string().optional(),
  provider: providerEnum,
  model: z.string().optional(),
  stream: z.boolean().optional(),
  apiKey: z.string().optional(),
  // Base URL for the user-configurable "custom" OpenAI-compatible endpoint.
  baseUrl: z.string().max(500).optional(),
  maxTokens: z.number().int().min(1).max(128000).optional(),
  temperature: z.number().min(0).max(2).optional(),
});

export const validateRequestSchema = z.object({
  provider: providerEnum,
  // Local providers (Ollama) need no key, so an empty string is allowed.
  apiKey: z.string().optional().default(""),
  // "oauth" validates Gemini/Claude via the logged-in CLI instead of a key.
  authMode: z.enum(["key", "oauth"]).optional().default("key"),
  // Base URL for the user-configurable "custom" OpenAI-compatible endpoint.
  baseUrl: z.string().max(500).optional(),
});

// --- Prompt Routes ---

export const createPromptSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional().default(""),
  content: z.string().min(1),
  structured: z.string().optional().default("{}"),
  tags: z.array(z.string().min(1).max(50)).max(20).optional().default([]),
});

export const updatePromptSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  content: z.string().min(1).optional(),
  structured: z.string().optional(),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
  changelog: z.string().max(500).optional(),
});

export const promptsPaginationSchema = z.object({
  q: z.string().optional().default(""),
  tag: z.string().optional().default(""),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

// --- Template Routes ---

export const createTemplateSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().default(""),
  category: z.string().min(1).max(50).optional().default("general"),
  content: z.string().min(1),
  structured: z.string().optional().default("{}"),
  isBuiltIn: z.boolean().optional().default(false),
});

// --- Test Result Routes ---

export const createTestResultSchema = z.object({
  promptId: z.string().min(1),
  provider: providerEnum,
  model: z.string().min(1),
  input: z.string(),
  output: z.string(),
  latencyMs: z.number().int().min(0),
  inputTokens: z.number().int().min(0).optional(),
  outputTokens: z.number().int().min(0).optional(),
  costUsd: z.number().min(0).optional(),
});

// --- Test Case (evaluation) Routes ---

export const matchTypeEnum = z.enum(["contains", "icontains", "regex", "equals"]);

export const createTestCaseSchema = z.object({
  name: z.string().max(200).optional().default(""),
  input: z.string().max(20000).optional().default(""),
  matchType: matchTypeEnum.optional().default("contains"),
  expected: z.string().max(20000).optional().default(""),
});

// --- Knowledge Base (RAG) Routes ---

export const createKnowledgeDocSchema = z.object({
  title: z.string().min(1).max(300),
  source: z.string().max(500).optional().default("manual"),
  content: z.string().min(1).max(500000),
});

export const knowledgeSearchSchema = z.object({
  query: z.string().min(1).max(4000),
  topK: z.coerce.number().int().min(1).max(20).optional().default(5),
});

// --- Assistant (code-assistant) Routes ---

export const createAssistantSessionSchema = z.object({
  provider: z.enum(["claude", "gemini", "opencode", "codex", "aider"]).optional().default("claude"),
  model: z.string().max(100).optional().default(""),
  title: z.string().max(200).optional().default(""),
  cwd: z.string().max(1000).optional().default(""),
  permissionMode: z.enum(["default", "acceptEdits", "plan", "bypassPermissions"]).optional().default("default"),
  allowedTools: z.string().max(500).optional().default("Read,Grep,Glob"),
  approvalMode: z.enum(["off", "edits", "all"]).optional().default("off"),
  sandbox: z.boolean().optional().default(false),
});

export const assistantMessageSchema = z.object({
  prompt: z.string().min(1).max(100000),
  apiKey: z.string().optional(),
});

export const orchestrateSchema = z.object({
  prompt: z.string().min(1).max(100000),
  preference: z.string().max(2000).optional(),
});

const plannedSubtaskSchema = z.object({
  id: z.string().min(1).max(50),
  title: z.string().max(300).optional().default(""),
  description: z.string().max(20000).optional().default(""),
  workerId: z.string().min(1).max(120),
  dependsOn: z.array(z.string().max(50)).max(20).optional().default([]),
  editsFiles: z.boolean().optional().default(false),
});

export const orchestrateRunSchema = z.object({
  prompt: z.string().min(1).max(100000),
  subtasks: z.array(plannedSubtaskSchema).min(1).max(20),
});

// --- Helper ---

export function formatZodError(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
}
