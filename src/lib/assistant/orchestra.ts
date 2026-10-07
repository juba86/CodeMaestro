import { prisma } from "@/lib/db/client";
import { formatZodError, orchestraConfigSchema } from "@/lib/validation/schemas";
import { discoverAllWorkers, toWorkerInfo, type ClientProvider } from "./orchestrator";
import {
  buildPreset,
  defaultOrchestraConfig,
  type OrchestraConfig,
  type OrchestraPresetId,
  type PresetResult,
} from "./orchestra-types";

// Persisted orchestra configuration — the org chart that decides which model
// plays which role. Stored as one JSON blob in the Setting table; the
// client-safe types, defaults, preset and validation logic live in
// orchestra-types.ts.

export const ORCHESTRA_SETTING_KEY = "orchestra.config";

/** The saved configuration, or the defaults when nothing (valid) is saved. */
export async function loadOrchestraConfig(): Promise<OrchestraConfig> {
  let raw: string | undefined;
  try {
    raw = (await prisma.setting.findUnique({ where: { key: ORCHESTRA_SETTING_KEY } }))?.value;
  } catch (err) {
    console.error("[orchestra] loading the configuration failed", err);
    return defaultOrchestraConfig();
  }
  if (!raw) return defaultOrchestraConfig();
  try {
    const parsed = orchestraConfigSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
    console.warn("[orchestra] saved configuration is invalid, using defaults:", formatZodError(parsed.error));
  } catch {
    console.warn("[orchestra] saved configuration is not valid JSON, using defaults");
  }
  return defaultOrchestraConfig();
}

/** Validates (normalizes) and saves the configuration. Throws on invalid input. */
export async function saveOrchestraConfig(config: OrchestraConfig): Promise<OrchestraConfig> {
  const next = orchestraConfigSchema.parse(config);
  const value = JSON.stringify(next);
  await prisma.setting.upsert({
    where: { key: ORCHESTRA_SETTING_KEY },
    update: { value },
    create: { key: ORCHESTRA_SETTING_KEY, value },
  });
  return next;
}

/** The configuration a run uses: unsaved edits from the request, else the saved one. */
export async function resolveOrchestra(override?: OrchestraConfig | null): Promise<OrchestraConfig> {
  return override ?? loadOrchestraConfig();
}

/**
 * Assignments for a preset, computed from the workers available now (not
 * saved). `base` keeps the user's roles and only reassigns the models.
 */
export async function generatePreset(
  preset: OrchestraPresetId,
  clientProviders: ClientProvider[] = [],
  base?: OrchestraConfig
): Promise<PresetResult> {
  const workers = await discoverAllWorkers(clientProviders);
  return buildPreset(preset, workers.map(toWorkerInfo), base);
}
