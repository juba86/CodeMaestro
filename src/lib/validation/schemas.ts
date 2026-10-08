import { z } from "zod";
import {
  ORCHESTRA_LIMITS,
  ORCHESTRA_PRESETS,
  ORCHESTRA_PRESET_VALUES,
  ROLE_ID_PATTERN,
} from "@/lib/assistant/orchestra-types";

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

/** Trims tags, drops empty ones and de-duplicates case-insensitively (first spelling wins). */
export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim();
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

// Normalised before the limits apply, so input like ["ai", "AI ", ""] can't
// hit PromptTag's @@unique([promptId, tag]) (a P2002 → 500) or be rejected.
export const promptTagsSchema = z
  .array(z.string().max(200))
  .max(100)
  .transform(normalizeTags)
  .pipe(z.array(z.string().min(1).max(50)).max(20));

export const createPromptSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional().default(""),
  content: z.string().min(1),
  structured: z.string().optional().default("{}"),
  tags: promptTagsSchema.optional().default([]),
});

export const updatePromptSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  content: z.string().min(1).optional(),
  structured: z.string().optional(),
  tags: promptTagsSchema.optional(),
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
  provider: z.enum(["claude", "gemini", "pi", "opencode", "codex", "aider"]).optional().default("claude"),
  model: z.string().max(200).optional().default(""),
  title: z.string().max(200).optional().default(""),
  cwd: z.string().max(1000).optional().default(""),
  permissionMode: z.enum(["default", "acceptEdits", "plan", "auto", "dontAsk", "bypassPermissions"]).optional().default("default"),
  allowedTools: z.string().max(500).optional().default("Read,Grep,Glob"),
  approvalMode: z.enum(["off", "edits", "all"]).optional().default("off"),
  sandbox: z.boolean().optional().default(false),
  // Continue an existing Claude Code conversation of the folder (`--resume`).
  resumeSessionId: z
    .string()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Ungültige Unterhaltungs-ID.")
    .optional(),
});

export const assistantMessageSchema = z.object({
  prompt: z.string().min(1).max(100000),
  apiKey: z.string().optional(),
  // Augment the turn with relevant knowledge-base context (RAG). Optional and
  // defaults on; the augmentation is a no-op when the index is empty/unreachable.
  useKnowledge: z.boolean().optional().default(true),
});

// Cloud/local OpenAI-compatible providers the user has configured client-side,
// offered to the orchestrator as optional text-only workers (keys/base URL live
// in the browser; the planner may route to them but is never forced to).
const clientProviderSchema = z.object({
  id: z.string().min(1).max(40),
  key: z.string().max(500).optional().default(""),
  baseUrl: z.string().max(500).optional().default(""),
});

// --- Orchestra (org chart: which model plays which role) ---
// Types, defaults and limits live in src/lib/assistant/orchestra-types.ts.

const orchestraRoleSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(ORCHESTRA_LIMITS.roleId)
    .regex(ROLE_ID_PATTERN, "Rollen-ID: nur Kleinbuchstaben, Ziffern, „-“ und „_“ (beginnend mit Buchstabe oder Ziffer)."),
  name: z.string().trim().min(1).max(ORCHESTRA_LIMITS.name),
  description: z.string().max(ORCHESTRA_LIMITS.description).optional().default(""),
  instructions: z.string().max(ORCHESTRA_LIMITS.instructions).optional().default(""),
  // "" = Auto (picked from the available workers at run time).
  workerId: z.string().trim().max(ORCHESTRA_LIMITS.workerId).optional().default(""),
  editsFiles: z.boolean().optional().default(false),
  enabled: z.boolean().optional().default(true),
  reviewLoop: z
    .object({
      enabled: z.boolean().optional().default(false),
      reviewerRoleId: z.string().trim().max(ORCHESTRA_LIMITS.roleId).optional().default(""),
      maxRounds: z.number().int().min(1).max(ORCHESTRA_LIMITS.maxRounds).optional().default(1),
    })
    .optional()
    .default({ enabled: false, reviewerRoleId: "", maxRounds: 1 }),
});

export const orchestraConfigSchema = z
  .object({
    version: z.literal(1).optional().default(1),
    conductor: z
      .object({
        workerId: z.string().trim().max(ORCHESTRA_LIMITS.workerId).optional().default(""),
        instructions: z.string().max(ORCHESTRA_LIMITS.instructions).optional().default(""),
      })
      .optional()
      .default({ workerId: "", instructions: "" }),
    roles: z.array(orchestraRoleSchema).max(ORCHESTRA_LIMITS.roles),
    preset: z.enum(ORCHESTRA_PRESET_VALUES).optional().default("custom"),
  })
  .superRefine((config, ctx) => {
    const seen = new Set<string>();
    config.roles.forEach((role, i) => {
      if (seen.has(role.id)) {
        ctx.addIssue({ code: "custom", path: ["roles", i, "id"], message: `Rollen-ID „${role.id}“ kommt mehrfach vor.` });
      }
      seen.add(role.id);
    });
  });

// PUT /api/orchestra
export const orchestraPutSchema = z.object({ config: orchestraConfigSchema });

// POST /api/orchestra/preset — `config` (optional) keeps the user's roles and
// only reassigns the models.
export const orchestraPresetSchema = z.object({
  preset: z.enum(ORCHESTRA_PRESETS),
  clientProviders: z.array(clientProviderSchema).max(20).optional().default([]),
  config: orchestraConfigSchema.optional(),
});

export const orchestrateSchema = z.object({
  prompt: z.string().min(1).max(100000),
  preference: z.string().max(2000).optional(),
  clientProviders: z.array(clientProviderSchema).max(20).optional().default([]),
  // Which worker plans (and synthesizes). "" / "auto" = the orchestra's
  // conductor (or an available model, without forcing a Claude account); a
  // worker id (e.g. "gemini", "ollama:...") pins it explicitly.
  plannerWorkerId: z.string().max(220).optional(),
  // Run with this (possibly unsaved) orchestra instead of the saved one.
  orchestra: orchestraConfigSchema.optional(),
});

const plannedSubtaskSchema = z.object({
  id: z.string().min(1).max(50),
  title: z.string().max(300).optional().default(""),
  description: z.string().max(20000).optional().default(""),
  workerId: z.string().min(1).max(220),
  dependsOn: z.array(z.string().max(50)).max(20).optional().default([]),
  editsFiles: z.boolean().optional().default(false),
  // The orchestra role that runs the subtask (role framing + review loop).
  roleId: z.string().max(ORCHESTRA_LIMITS.roleId).optional(),
});

export const orchestrateRunSchema = z.object({
  prompt: z.string().min(1).max(100000),
  subtasks: z.array(plannedSubtaskSchema).min(1).max(20),
  clientProviders: z.array(clientProviderSchema).max(20).optional().default([]),
  plannerWorkerId: z.string().max(220).optional(),
  orchestra: orchestraConfigSchema.optional(),
});

// Loop mode: repeat a task server-side until the agent prints the completion
// promise, the iteration cap is hit, or the user stops it (survives closed
// windows — the loop runs in the server's run registry).
export const assistantLoopSchema = z.object({
  prompt: z.string().min(1).max(100000),
  apiKey: z.string().optional(),
  useKnowledge: z.boolean().optional().default(false),
  maxIterations: z.number().int().min(1).max(100).optional().default(10),
  // Text the agent outputs (as <promise>TEXT</promise>) once the task is done.
  completionPromise: z.string().trim().min(1).max(100).optional().default("DONE"),
  // Pause between iterations (0 = back-to-back; >0 = recurring like /loop 10m).
  intervalSec: z.number().int().min(0).max(86400).optional().default(0),
  // true = fresh CLI context per iteration (state lives in files, "Ralph"
  // style); false = continue the same conversation.
  freshContext: z.boolean().optional().default(false),
  // Stop the loop when an iteration ends with an error.
  stopOnError: z.boolean().optional().default(true),
});

// --- Telegram bridge ---

export const telegramConfigSchema = z.object({
  enabled: z.boolean().optional(),
  // Empty string clears the token; a real token looks like 123456:AA... .
  token: z.string().max(200).optional(),
  allowedChatIds: z.array(z.number().int()).max(50).optional(),
  cwd: z.string().max(1000).optional(),
  permissionMode: z.enum(["default", "acceptEdits", "plan", "auto", "dontAsk", "bypassPermissions"]).optional(),
  approvalMode: z.enum(["off", "edits", "all"]).optional(),
  provider: z.enum(["claude", "gemini", "pi", "opencode", "codex", "aider"]).optional(),
  model: z.string().max(200).optional(),
  useKnowledge: z.boolean().optional(),
});

export const telegramControlSchema = z.object({
  action: z.enum(["start", "stop", "test"]),
  token: z.string().max(200).optional(),
});

// --- Helper ---

export function formatZodError(error: z.ZodError): string {
  return error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ");
}
