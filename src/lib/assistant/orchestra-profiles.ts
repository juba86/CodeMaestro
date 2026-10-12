import { randomUUID } from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { orchestraConfigSchema } from "@/lib/validation/schemas";
import type { OrchestraConfig } from "./orchestra-types";

// Named snapshots of the orchestra configuration ("Profile"): the user saves
// the chart under a name and loads it back into the editor later. Stored as
// one JSON blob in the Setting table, next to the active configuration.

export const ORCHESTRA_PROFILES_KEY = "orchestra.profiles";
export const MAX_PROFILES = 30;
export const PROFILE_NAME_MAX = 60;

export interface OrchestraProfile {
  id: string;
  name: string;
  config: OrchestraConfig;
  /** ISO time of the last save. */
  savedAt: string;
}

const profileSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(PROFILE_NAME_MAX),
  config: orchestraConfigSchema,
  savedAt: z.string(),
});

export class ProfileLimitError extends Error {}

/** The saved profiles, by name. Entries that no longer validate are dropped. */
export async function listProfiles(): Promise<OrchestraProfile[]> {
  const raw = (await prisma.setting.findUnique({ where: { key: ORCHESTRA_PROFILES_KEY } }))?.value;
  if (!raw) return [];
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const out: OrchestraProfile[] = [];
  for (const v of list) {
    const p = profileSchema.safeParse(v);
    if (p.success) out.push(p.data);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "de"));
}

async function store(profiles: OrchestraProfile[]): Promise<void> {
  const value = JSON.stringify(profiles);
  await prisma.setting.upsert({
    where: { key: ORCHESTRA_PROFILES_KEY },
    update: { value },
    create: { key: ORCHESTRA_PROFILES_KEY, value },
  });
}

/** Saves the configuration under `name`; a profile of the same name is replaced. */
export async function saveProfile(name: string, config: OrchestraConfig): Promise<OrchestraProfile[]> {
  const clean = name.trim().slice(0, PROFILE_NAME_MAX);
  const profiles = await listProfiles();
  const existing = profiles.find((p) => p.name.toLowerCase() === clean.toLowerCase());
  if (!existing && profiles.length >= MAX_PROFILES) throw new ProfileLimitError(`Mehr als ${MAX_PROFILES} Profile gehen nicht – erst eines löschen.`);
  const profile: OrchestraProfile = {
    id: existing?.id ?? randomUUID(),
    name: clean,
    config: orchestraConfigSchema.parse(config),
    savedAt: new Date().toISOString(),
  };
  await store([...profiles.filter((p) => p !== existing), profile]);
  return listProfiles();
}

export async function deleteProfile(id: string): Promise<OrchestraProfile[]> {
  const profiles = await listProfiles();
  if (profiles.some((p) => p.id === id)) await store(profiles.filter((p) => p.id !== id));
  return listProfiles();
}
