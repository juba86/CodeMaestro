import { z } from "zod";

// --- Shared enums ---

const providerEnum = z.enum(["claude", "gemini"]);

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
  maxTokens: z.number().int().min(1).max(128000).optional(),
  temperature: z.number().min(0).max(2).optional(),
});

export const validateRequestSchema = z.object({
  provider: providerEnum,
  apiKey: z.string().min(1),
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
});

// --- Helper ---

export function formatZodError(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
}
