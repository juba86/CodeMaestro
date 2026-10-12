import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ rows: new Map<string, string>() }));
vi.mock("@/lib/db/client", () => ({
  prisma: {
    setting: {
      findUnique: async ({ where }: { where: { key: string } }) => (db.rows.has(where.key) ? { value: db.rows.get(where.key) } : null),
      upsert: async ({ where, create }: { where: { key: string }; create: { value: string } }) => { db.rows.set(where.key, create.value); },
    },
  },
}));

import { defaultOrchestraConfig } from "./orchestra-types";
import { MAX_PROFILES, ORCHESTRA_PROFILES_KEY, ProfileLimitError, deleteProfile, listProfiles, saveProfile } from "./orchestra-profiles";

beforeEach(() => db.rows.clear());

describe("orchestra profiles", () => {
  it("saves, replaces by name, lists by name and deletes", async () => {
    const quality = defaultOrchestraConfig();
    quality.conductor.workerId = "claude:opus";
    await saveProfile("  Qualität ", quality);
    await saveProfile("Günstig", defaultOrchestraConfig());
    let list = await listProfiles();
    expect(list.map((p) => p.name)).toEqual(["Günstig", "Qualität"]);
    expect(list[1].config.conductor.workerId).toBe("claude:opus");

    const id = list[1].id;
    const cheaper = defaultOrchestraConfig();
    cheaper.conductor.workerId = "claude:haiku";
    list = await saveProfile("qualität", cheaper);
    expect(list).toHaveLength(2);
    expect(list.find((p) => p.id === id)).toMatchObject({ name: "qualität", config: { conductor: { workerId: "claude:haiku" } } });

    expect((await deleteProfile(id)).map((p) => p.name)).toEqual(["Günstig"]);
    expect(await deleteProfile("unknown")).toHaveLength(1);
  });

  it("drops entries that no longer validate and refuses more than the limit", async () => {
    db.rows.set(ORCHESTRA_PROFILES_KEY, JSON.stringify([{ id: "x", name: "kaputt", config: { roles: "nope" }, savedAt: "" }]));
    expect(await listProfiles()).toEqual([]);
    db.rows.set(ORCHESTRA_PROFILES_KEY, "not json");
    expect(await listProfiles()).toEqual([]);
    for (let i = 0; i < MAX_PROFILES; i++) await saveProfile(`p${i}`, defaultOrchestraConfig());
    await expect(saveProfile("eins zu viel", defaultOrchestraConfig())).rejects.toBeInstanceOf(ProfileLimitError);
    await expect(saveProfile("P0", defaultOrchestraConfig())).resolves.toHaveLength(MAX_PROFILES);
  });
});
