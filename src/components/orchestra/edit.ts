// Pure edit operations on an OrchestraConfig (the editor's draft). Every
// manual change sets `preset` to "custom" (§6.3.2); nothing here is saved —
// PUT /api/orchestra does that.

import {
  DEFAULT_ROLES,
  ORCHESTRA_LIMITS,
  ORCHESTRA_PRESET_VALUES,
  ROLE_ID_PATTERN,
  clampRounds,
  slugifyRoleId,
  type OrchestraConductor,
  type OrchestraConfig,
  type OrchestraPreset,
  type OrchestraRole,
  type ReviewLoopConfig,
} from "@/lib/assistant/orchestra-types";
import { columnOf, uniqueRoleName, type OrchestraColumn, type RoleTemplate } from "./derive";

/** Assignment target of the Dirigent. Role ids are slugs, so this never collides. */
export const CONDUCTOR_TARGET = "@dirigent";

export type RolePatch = Partial<Omit<OrchestraRole, "id" | "reviewLoop">> & { reviewLoop?: Partial<ReviewLoopConfig> };

function custom(config: OrchestraConfig, roles: OrchestraRole[] = config.roles, conductor = config.conductor): OrchestraConfig {
  return { ...config, conductor, roles, preset: "custom" };
}

export function findRole(config: Pick<OrchestraConfig, "roles">, roleId: string): OrchestraRole | undefined {
  return config.roles.find((r) => r.id === roleId);
}

/** The configured worker id of a target ("" = Automatisch). */
export function workerIdOf(config: OrchestraConfig, target: string): string | undefined {
  if (target === CONDUCTOR_TARGET) return config.conductor.workerId;
  return findRole(config, target)?.workerId;
}

/** Assigns a worker ("" = Automatisch) to the Dirigent or a role. */
export function setWorker(config: OrchestraConfig, target: string, workerId: string): OrchestraConfig {
  if (target === CONDUCTOR_TARGET) return updateConductor(config, { workerId });
  return updateRole(config, target, { workerId });
}

export function updateConductor(config: OrchestraConfig, patch: Partial<OrchestraConductor>): OrchestraConfig {
  return custom(config, config.roles, { ...config.conductor, ...patch });
}

export function updateRole(config: OrchestraConfig, roleId: string, patch: RolePatch): OrchestraConfig {
  if (!findRole(config, roleId)) return config;
  const roles = config.roles.map((r) => {
    if (r.id !== roleId) return r;
    const { reviewLoop, ...rest } = patch;
    const loop = reviewLoop ? { ...r.reviewLoop, ...reviewLoop } : r.reviewLoop;
    return { ...r, ...rest, reviewLoop: { ...loop, maxRounds: clampRounds(loop.maxRounds) } };
  });
  return custom(config, roles);
}

/**
 * A sensible reviewer for `roleId`'s Prüfschleife: an enabled role already in
 * Prüfen, else „reviewer", else another enabled read-only role, else any other role.
 */
export function defaultReviewerFor(config: OrchestraConfig, roleId: string): string {
  const others = config.roles.filter((r) => r.id !== roleId);
  const pick =
    others.find((r) => r.enabled && columnOf(r, config) === "review") ??
    others.find((r) => r.id === "reviewer") ??
    others.find((r) => r.enabled && !r.editsFiles) ??
    others.find((r) => r.enabled) ??
    others[0];
  return pick?.id ?? "";
}

/** Switches/edits a Prüfschleife; enabling it without a valid reviewer picks one. */
export function setReviewLoop(config: OrchestraConfig, roleId: string, patch: Partial<ReviewLoopConfig>): OrchestraConfig {
  const role = findRole(config, roleId);
  if (!role) return config;
  const next = { ...role.reviewLoop, ...patch };
  if (next.enabled) {
    const reviewer = findRole(config, next.reviewerRoleId);
    if (!reviewer || reviewer.id === roleId) next.reviewerRoleId = defaultReviewerFor(config, roleId);
  }
  return updateRole(config, roleId, { reviewLoop: next });
}

// --- Names ------------------------------------------------------------------------

/** Inline validation for a role name (§6.3.6); null when fine. */
export function validateRoleName(config: Pick<OrchestraConfig, "roles">, roleId: string, name: string): string | null {
  const clean = name.trim();
  if (!clean) return "Gib der Rolle einen Namen.";
  if (clean.length > ORCHESTRA_LIMITS.name) return `Höchstens ${ORCHESTRA_LIMITS.name} Zeichen.`;
  const lower = clean.toLowerCase();
  if (config.roles.some((r) => r.id !== roleId && r.name.trim().toLowerCase() === lower)) return "Name schon vergeben";
  return null;
}

/** Renames a role (never changes its id — plans and review loops reference it). */
export function renameRole(config: OrchestraConfig, roleId: string, name: string): OrchestraConfig {
  const role = findRole(config, roleId);
  if (!role || role.name === name.trim()) return config;
  return updateRole(config, roleId, { name: name.trim() });
}

// --- Add / duplicate / remove ---------------------------------------------------------

/** „Eigene Rolle …": an empty role whose capability follows the column it is added to. */
export const CUSTOM_ROLE_TEMPLATE: RoleTemplate = {
  id: "",
  name: "Neue Rolle",
  description: "",
  instructions: "",
  editsFiles: false,
};

export interface AddRoleResult {
  config: OrchestraConfig;
  roleId: string;
  column: OrchestraColumn;
  /** The Umsetzen role whose Prüfschleife the new role now reviews (added to Prüfen). */
  reviews?: string;
}

/**
 * Adds a role from a template. Column defaults (§6.3.3): Planen → read-only,
 * Umsetzen → may change files, Prüfen → read-only and wired as the reviewer
 * of the first Umsetzen role without a Prüfschleife. A suggestion keeps its
 * own capability; „Eigene Rolle …" (empty template id) follows the column.
 * Null at the role limit.
 */
export function addRole(config: OrchestraConfig, template: RoleTemplate, column?: OrchestraColumn): AddRoleResult | null {
  if (config.roles.length >= ORCHESTRA_LIMITS.roles) return null;
  const isCustom = !template.id;
  const editsFiles = isCustom && column ? column === "build" : template.editsFiles;
  const name = uniqueRoleName(template.name, config.roles);
  const id = slugifyRoleId(isCustom ? name : template.id, config.roles.map((r) => r.id));
  const role: OrchestraRole = {
    id,
    name,
    description: template.description,
    instructions: template.instructions,
    workerId: "",
    editsFiles,
    enabled: true,
    reviewLoop: { enabled: false, reviewerRoleId: "", maxRounds: 1 },
  };
  let roles = [...config.roles, role];
  let reviews: string | undefined;
  if (column === "review" && !editsFiles) {
    const target = config.roles.find(
      (r) => r.enabled && columnOf(r, config) === "build" && !(r.reviewLoop.enabled && findRole(config, r.reviewLoop.reviewerRoleId))
    );
    if (target) {
      reviews = target.id;
      roles = roles.map((r) =>
        r.id === target.id ? { ...r, reviewLoop: { enabled: true, reviewerRoleId: id, maxRounds: clampRounds(r.reviewLoop.maxRounds) } } : r
      );
    }
  }
  const next = custom(config, roles);
  return { config: next, roleId: id, column: columnOf(role, next), reviews };
}

/** Templates for the add-role popover: the DEFAULT_ROLES that are missing, then `extras`. */
export function roleSuggestions(
  config: Pick<OrchestraConfig, "roles">,
  extras: readonly RoleTemplate[]
): RoleTemplate[] {
  const ids = new Set(config.roles.map((r) => r.id));
  const names = new Set(config.roles.map((r) => r.name.trim().toLowerCase()));
  const present = (t: RoleTemplate) => ids.has(t.id) || names.has(t.name.toLowerCase());
  const defaults: RoleTemplate[] = DEFAULT_ROLES.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    instructions: r.instructions,
    editsFiles: r.editsFiles,
  }));
  return [...defaults, ...extras].filter((t) => !present(t));
}

/** Copies a role („Coder 2", new slug) right after the original. Null at the limit. */
export function duplicateRole(config: OrchestraConfig, roleId: string): { config: OrchestraConfig; roleId: string } | null {
  const index = config.roles.findIndex((r) => r.id === roleId);
  if (index < 0 || config.roles.length >= ORCHESTRA_LIMITS.roles) return null;
  const source = config.roles[index];
  const name = uniqueRoleName(`${source.name.replace(/\s+\d+$/, "")} 2`, config.roles);
  const id = slugifyRoleId(name, config.roles.map((r) => r.id));
  const copy: OrchestraRole = { ...source, id, name, reviewLoop: { ...source.reviewLoop } };
  const roles = [...config.roles.slice(0, index + 1), copy, ...config.roles.slice(index + 1)];
  return { config: custom(config, roles), roleId: id };
}

export interface RoleRemoval {
  role: OrchestraRole;
  index: number;
  /** Roles whose Prüfschleife pointed to the removed role and was switched off. */
  loopsOff: string[];
}

/** Removes a role and switches off Prüfschleifen that pointed to it (restored by restoreRole). */
export function removeRole(config: OrchestraConfig, roleId: string): { config: OrchestraConfig; removal: RoleRemoval } | null {
  const index = config.roles.findIndex((r) => r.id === roleId);
  if (index < 0) return null;
  const role = config.roles[index];
  const loopsOff: string[] = [];
  const roles = config.roles
    .filter((r) => r.id !== roleId)
    .map((r) => {
      if (!(r.reviewLoop.enabled && r.reviewLoop.reviewerRoleId === roleId)) return r;
      loopsOff.push(r.id);
      return { ...r, reviewLoop: { ...r.reviewLoop, enabled: false } };
    });
  return { config: custom(config, roles), removal: { role, index, loopsOff } };
}

/** Undo for removeRole: puts the role back and re-enables the loops it reviewed. Null when its id is taken meanwhile. */
export function restoreRole(config: OrchestraConfig, removal: RoleRemoval): OrchestraConfig | null {
  const { role, index, loopsOff } = removal;
  if (findRole(config, role.id) || config.roles.length >= ORCHESTRA_LIMITS.roles) return null;
  const at = Math.min(index, config.roles.length);
  const roles = [...config.roles.slice(0, at), role, ...config.roles.slice(at)].map((r) =>
    loopsOff.includes(r.id) && !r.reviewLoop.enabled && r.reviewLoop.reviewerRoleId === role.id
      ? { ...r, reviewLoop: { ...r.reviewLoop, enabled: true } }
      : r
  );
  return custom(config, roles);
}

// --- Order ------------------------------------------------------------------------

function neighbourInColumn(config: OrchestraConfig, roleId: string, dir: -1 | 1): number {
  const index = config.roles.findIndex((r) => r.id === roleId);
  if (index < 0) return -1;
  const column = columnOf(config.roles[index], config);
  for (let i = index + dir; i >= 0 && i < config.roles.length; i += dir) {
    if (columnOf(config.roles[i], config) === column) return i;
  }
  return -1;
}

export function canMoveRole(config: OrchestraConfig, roleId: string, dir: -1 | 1): boolean {
  return neighbourInColumn(config, roleId, dir) >= 0;
}

/** „Nach oben" / „Nach unten": swaps with the neighbour in the same column (order lives in config.roles). */
export function moveRole(config: OrchestraConfig, roleId: string, dir: -1 | 1): OrchestraConfig {
  const index = config.roles.findIndex((r) => r.id === roleId);
  const other = neighbourInColumn(config, roleId, dir);
  if (index < 0 || other < 0) return config;
  const roles = [...config.roles];
  [roles[index], roles[other]] = [roles[other], roles[index]];
  return custom(config, roles);
}

// --- Comparison and drafts ------------------------------------------------------------

function canonicalRole(r: OrchestraRole) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    instructions: r.instructions,
    workerId: r.workerId,
    editsFiles: r.editsFiles,
    enabled: r.enabled,
    reviewLoop: { enabled: r.reviewLoop.enabled, reviewerRoleId: r.reviewLoop.reviewerRoleId, maxRounds: r.reviewLoop.maxRounds },
  };
}

/** Stable JSON of a config (key order independent of how the objects were built). */
export function canonicalConfig(config: OrchestraConfig): string {
  return JSON.stringify({
    version: 1,
    conductor: { workerId: config.conductor.workerId, instructions: config.conductor.instructions },
    roles: config.roles.map(canonicalRole),
    preset: config.preset,
  });
}

export function configsEqual(a: OrchestraConfig | null | undefined, b: OrchestraConfig | null | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return canonicalConfig(a) === canonicalConfig(b);
}

/** Like configsEqual, but ignores the preset marker (did anything real change?). */
export function sameAssignments(a: OrchestraConfig, b: OrchestraConfig): boolean {
  return canonicalConfig({ ...a, preset: "custom" }) === canonicalConfig({ ...b, preset: "custom" });
}

/** Names of what changed against `baseline` („geändert: Tester, Doku"), Dirigent first. */
export function changedRoleNames(baseline: OrchestraConfig, draft: OrchestraConfig): string[] {
  const out: string[] = [];
  if (
    baseline.conductor.workerId !== draft.conductor.workerId ||
    baseline.conductor.instructions !== draft.conductor.instructions
  ) {
    out.push("Dirigent");
  }
  const before = new Map(baseline.roles.map((r) => [r.id, JSON.stringify(canonicalRole(r))]));
  for (const r of draft.roles) {
    if (before.get(r.id) !== JSON.stringify(canonicalRole(r))) out.push(r.name.trim() || r.id);
  }
  const now = new Set(draft.roles.map((r) => r.id));
  for (const r of baseline.roles) if (!now.has(r.id)) out.push(r.name.trim() || r.id);
  return out;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string";
const bool = (v: unknown): v is boolean => typeof v === "boolean";

function parseRole(v: unknown): OrchestraRole | null {
  if (!isObj(v) || !isObj(v.reviewLoop)) return null;
  const loop = v.reviewLoop;
  if (!str(v.id) || !ROLE_ID_PATTERN.test(v.id) || !str(v.name) || !str(v.description) || !str(v.instructions)) return null;
  if (!str(v.workerId) || !bool(v.editsFiles) || !bool(v.enabled)) return null;
  if (!bool(loop.enabled) || !str(loop.reviewerRoleId) || typeof loop.maxRounds !== "number") return null;
  return {
    id: v.id,
    name: v.name,
    description: v.description,
    instructions: v.instructions,
    workerId: v.workerId,
    editsFiles: v.editsFiles,
    enabled: v.enabled,
    reviewLoop: { enabled: loop.enabled, reviewerRoleId: loop.reviewerRoleId, maxRounds: clampRounds(loop.maxRounds) },
  };
}

/** Validates an untrusted value (a stored draft) as a config; null when it does not fit. */
export function parseConfig(v: unknown): OrchestraConfig | null {
  if (!isObj(v) || !isObj(v.conductor) || !Array.isArray(v.roles)) return null;
  if (v.version !== undefined && v.version !== 1) return null;
  if (!str(v.conductor.workerId) || !str(v.conductor.instructions)) return null;
  if (v.roles.length > ORCHESTRA_LIMITS.roles * 4) return null;
  const roles: OrchestraRole[] = [];
  for (const raw of v.roles) {
    const role = parseRole(raw);
    if (!role) return null;
    roles.push(role);
  }
  const preset = (ORCHESTRA_PRESET_VALUES as readonly string[]).includes(String(v.preset))
    ? (v.preset as OrchestraPreset)
    : "custom";
  return {
    version: 1,
    conductor: { workerId: v.conductor.workerId, instructions: v.conductor.instructions },
    roles,
    preset,
  };
}
