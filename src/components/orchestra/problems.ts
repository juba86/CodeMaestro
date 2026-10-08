// Structured problems of an orchestra draft (DESIGN.md §6.3.7). Only what
// PUT /api/orchestra would reject (plus duplicate names, for clarity) is an
// error and blocks saving; everything else is a warning or info, matching the
// backend rule that nothing blocks a run (unavailable models fall back to Auto).

import {
  NO_MODEL_WARNING,
  ORCHESTRA_LIMITS,
  ROLE_ID_PATTERN,
  bestFileWorker,
  resolveConductor,
  resolveRoleWorker,
  strongestWorker,
  type OrchestraConfig,
  type OrchestraRole,
  type OrchestraWorkerInfo,
} from "@/lib/assistant/orchestra-types";
import { workerFamily, workerLabel, workerShortLabel } from "./derive";
import { CONDUCTOR_TARGET, findRole, setReviewLoop, setWorker, updateRole } from "./edit";

export type ProblemSeverity = "error" | "warning" | "info";

/** UI actions a fix stands for when it does not change the config itself. */
export type ProblemIntent = "pick-model" | "add-role" | "providers" | "rename";

export interface OrchestraProblemFix {
  label: string;
  apply: (config: OrchestraConfig) => OrchestraConfig;
  /** Set for fixes the UI performs (open the picker, add a role, go to settings); `apply` is then the identity. */
  intent?: ProblemIntent;
}

export interface OrchestraProblem {
  id: string;
  severity: ProblemSeverity;
  /** The role it concerns; absent for global problems. */
  roleId?: string;
  /** True when it concerns the Dirigent. */
  conductor?: boolean;
  /** Which part of the role/Dirigent: shown inline next to that field. */
  field?: "name" | "model" | "review" | "role";
  /** A capability mismatch: the model slot shows danger + PenOff (§6.3.7 visuals). */
  capability?: boolean;
  message: string;
  fixes: OrchestraProblemFix[];
}

const q = (s: string) => `‚${s}‘`;
const roleName = (r: OrchestraRole) => r.name.trim() || r.id;
const identity = (c: OrchestraConfig) => c;

/**
 * Derives the problems of `config`. `workers === null` means the model list is
 * not known (loading or failed): model checks are skipped instead of guessed.
 */
export function deriveProblems(
  config: OrchestraConfig,
  workers: readonly OrchestraWorkerInfo[] | null
): OrchestraProblem[] {
  const out: OrchestraProblem[] = [];
  const roles = config.roles;

  // --- Errors: what the PUT schema rejects, plus duplicate names. ---
  if (roles.length > ORCHESTRA_LIMITS.roles) {
    out.push({ id: "roles-limit", severity: "error", message: `Maximal ${ORCHESTRA_LIMITS.roles} Rollen.`, fixes: [] });
  }
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  for (const role of roles) {
    if (seenIds.has(role.id) || !ROLE_ID_PATTERN.test(role.id) || role.id.length > ORCHESTRA_LIMITS.roleId) {
      out.push({
        id: `role-id:${role.id}:${out.length}`,
        severity: "error",
        roleId: role.id,
        field: "role",
        message: `Rollen-ID ${q(role.id)} ist ungültig oder doppelt – entferne die Rolle oder lege sie neu an.`,
        fixes: [],
      });
    }
    seenIds.add(role.id);
    const name = role.name.trim();
    if (!name) {
      out.push({
        id: `name-empty:${role.id}`,
        severity: "error",
        roleId: role.id,
        field: "name",
        message: "Gib der Rolle einen Namen.",
        fixes: [{ label: "Umbenennen", apply: identity, intent: "rename" }],
      });
    } else if (name.length > ORCHESTRA_LIMITS.name) {
      out.push({
        id: `name-long:${role.id}`,
        severity: "error",
        roleId: role.id,
        field: "name",
        message: `Der Name ist zu lang (höchstens ${ORCHESTRA_LIMITS.name} Zeichen).`,
        fixes: [{ label: "Umbenennen", apply: identity, intent: "rename" }],
      });
    } else if (seenNames.has(name.toLowerCase())) {
      out.push({
        id: `name-dup:${role.id}`,
        severity: "error",
        roleId: role.id,
        field: "name",
        message: "Name schon vergeben.",
        fixes: [{ label: "Umbenennen", apply: identity, intent: "rename" }],
      });
    }
    if (name) seenNames.add(name.toLowerCase());
    if (role.description.length > ORCHESTRA_LIMITS.description) {
      out.push({
        id: `desc-long:${role.id}`,
        severity: "error",
        roleId: role.id,
        field: "role",
        message: `Die Beschreibung ist zu lang (höchstens ${ORCHESTRA_LIMITS.description} Zeichen).`,
        fixes: [],
      });
    }
    if (role.instructions.length > ORCHESTRA_LIMITS.instructions) {
      out.push({
        id: `instr-long:${role.id}`,
        severity: "error",
        roleId: role.id,
        field: "role",
        message: `Die Anweisung ist zu lang (höchstens ${ORCHESTRA_LIMITS.instructions} Zeichen).`,
        fixes: [],
      });
    }
  }
  if (config.conductor.instructions.length > ORCHESTRA_LIMITS.instructions) {
    out.push({
      id: "conductor-instr-long",
      severity: "error",
      conductor: true,
      message: `Die Anweisung des Dirigenten ist zu lang (höchstens ${ORCHESTRA_LIMITS.instructions} Zeichen).`,
      fixes: [],
    });
  }

  // --- Structure warnings (independent of the models). ---
  const enabled = roles.filter((r) => r.enabled);
  if (!enabled.length) {
    out.push({
      id: "no-enabled-role",
      severity: "warning",
      message: "Keine Rolle aktiv – der Dirigent verteilt Teilaufgaben direkt an Modelle.",
      fixes: roles.length
        ? [{ label: "Alle Rollen aktivieren", apply: (c) => c.roles.reduce((acc, r) => updateRole(acc, r.id, { enabled: true }), c) }]
        : [{ label: "Rolle hinzufügen", apply: identity, intent: "add-role" }],
    });
  }
  for (const role of enabled) {
    const loop = role.reviewLoop;
    if (!loop.enabled) continue;
    const loopOff: OrchestraProblemFix = {
      label: "Prüfschleife ausschalten",
      apply: (c) => setReviewLoop(c, role.id, { enabled: false }),
    };
    const reviewer = findRole(config, loop.reviewerRoleId);
    if (!reviewer) {
      out.push({
        id: `loop-missing:${role.id}`,
        severity: "warning",
        roleId: role.id,
        field: "review",
        message: "Die Prüfschleife zeigt auf eine Rolle, die es nicht gibt.",
        fixes: [loopOff],
      });
    } else if (reviewer.id === role.id) {
      out.push({
        id: `loop-self:${role.id}`,
        severity: "warning",
        roleId: role.id,
        field: "review",
        message: `${q(roleName(role))} kann sich nicht selbst prüfen.`,
        fixes: [loopOff],
      });
    } else if (!reviewer.enabled) {
      out.push({
        id: `loop-disabled:${role.id}`,
        severity: "warning",
        roleId: role.id,
        field: "review",
        message: `Reviewer ${q(roleName(reviewer))} ist deaktiviert – die Prüfschleife wird übersprungen.`,
        fixes: [loopOff, { label: "Reviewer aktivieren", apply: (c) => updateRole(c, reviewer.id, { enabled: true }) }],
      });
    }
  }

  // --- Model checks (only when the worker list is known). ---
  if (workers === null) return out;
  if (!workers.length) {
    out.push({
      id: "no-workers",
      severity: "warning",
      message: NO_MODEL_WARNING,
      fixes: [{ label: "Zu den Providern", apply: identity, intent: "providers" }],
    });
    return out;
  }
  const list = [...workers];
  const conductorId = config.conductor.workerId.trim();
  const conductor = resolveConductor(list, conductorId);
  if (conductor.unavailable) {
    out.push({
      id: "conductor-unavailable",
      severity: "warning",
      conductor: true,
      field: "model",
      message: `Modell ${q(conductorId)} ist nicht verfügbar – Automatisch wird verwendet.`,
      fixes: [
        { label: "Automatisch", apply: (c) => setWorker(c, CONDUCTOR_TARGET, "") },
        { label: "Modell wählen", apply: identity, intent: "pick-model" },
      ],
    });
  } else if (conductor.auto && conductor.worker) {
    out.push({
      id: "conductor-auto",
      severity: "info",
      conductor: true,
      field: "model",
      message: `Automatisch – gewählt wird beim Start: ${workerLabel(conductor.worker)}.`,
      fixes: [],
    });
  }

  const fileWorker = bestFileWorker(list);
  const resolved = new Map(enabled.map((r) => [r.id, resolveRoleWorker(r, list, { conductor: conductor.worker })]));
  for (const role of enabled) {
    const r = resolved.get(role.id)!;
    const readOnly: OrchestraProblemFix = { label: "Nur lesen lassen", apply: (c) => updateRole(c, role.id, { editsFiles: false }) };
    if (r.unavailable) {
      out.push({
        id: `model-unavailable:${role.id}`,
        severity: "warning",
        roleId: role.id,
        field: "model",
        message: `Modell ${q(role.workerId.trim())} ist nicht verfügbar – Automatisch wird verwendet.`,
        fixes: [
          { label: "Automatisch", apply: (c) => setWorker(c, role.id, "") },
          { label: "Modell wählen", apply: identity, intent: "pick-model" },
        ],
      });
    }
    if (role.editsFiles && r.worker && !r.worker.editsFiles) {
      if (!r.auto) {
        out.push({
          id: `capability:${role.id}`,
          severity: "warning",
          roleId: role.id,
          field: "model",
          capability: true,
          message: `${q(roleName(role))} soll Dateien ändern, aber ${workerShortLabel(r.worker)} liefert nur Text.`,
          fixes: [
            ...(fileWorker
              ? [{ label: `${workerLabel(fileWorker)} nehmen`, apply: (c: OrchestraConfig) => setWorker(c, role.id, fileWorker.id) }]
              : []),
            readOnly,
          ],
        });
      } else if (!fileWorker) {
        out.push({
          id: `no-file-worker:${role.id}`,
          severity: "warning",
          roleId: role.id,
          field: "model",
          capability: true,
          message: `Kein Modell mit Dateizugriff verfügbar – ${q(roleName(role))} liefert nur Text.`,
          fixes: [readOnly],
        });
      }
    }
    if (r.auto && !r.unavailable && r.worker) {
      out.push({
        id: `auto:${role.id}`,
        severity: "info",
        roleId: role.id,
        field: "model",
        message: `Automatisch – gewählt wird beim Start: ${workerLabel(r.worker)}.`,
        fixes: [],
      });
    }
  }

  // Second opinion: reviewer and reviewed role on the same model.
  for (const role of enabled) {
    const loop = role.reviewLoop;
    if (!loop.enabled) continue;
    const reviewer = findRole(config, loop.reviewerRoleId);
    if (!reviewer || reviewer.id === role.id || !reviewer.enabled) continue;
    const a = resolved.get(role.id)?.worker;
    const b = resolved.get(reviewer.id)?.worker;
    if (!a || !b || a.id !== b.id) continue;
    const other = strongestWorker(list.filter((w) => workerFamily(w) !== workerFamily(a)), true);
    out.push({
      id: `same-model:${role.id}`,
      severity: "info",
      roleId: reviewer.id,
      field: "model",
      message: `${roleName(reviewer)} und ${roleName(role)} nutzen dasselbe Modell – eine zweite Meinung prüft wirksamer.`,
      fixes: other ? [{ label: `${workerLabel(other)} nehmen`, apply: (c) => setWorker(c, reviewer.id, other.id) }] : [],
    });
  }
  return out;
}

export interface ProblemCounts {
  errors: number;
  warnings: number;
  infos: number;
}

export function countProblems(problems: readonly OrchestraProblem[]): ProblemCounts {
  const c: ProblemCounts = { errors: 0, warnings: 0, infos: 0 };
  for (const p of problems) {
    if (p.severity === "error") c.errors++;
    else if (p.severity === "warning") c.warnings++;
    else c.infos++;
  }
  return c;
}

/** Header badge text: „1 Problem" / „3 Probleme" (errors) or „2 Hinweise" (warnings); null when clean. */
export function problemBadgeText(counts: ProblemCounts): { tone: "danger" | "warning"; text: string; short: string } | null {
  if (counts.errors) {
    return { tone: "danger", text: counts.errors === 1 ? "1 Problem" : `${counts.errors} Probleme`, short: String(counts.errors) };
  }
  if (counts.warnings) {
    return { tone: "warning", text: counts.warnings === 1 ? "1 Hinweis" : `${counts.warnings} Hinweise`, short: String(counts.warnings) };
  }
  return null;
}

/** „Erst 1 Problem beheben" when errors block saving. */
export function saveBlockedReason(counts: ProblemCounts): string | null {
  if (!counts.errors) return null;
  return counts.errors === 1 ? "Erst 1 Problem beheben" : `Erst ${counts.errors} Probleme beheben`;
}

/** Problems of one role (or the Dirigent with roleId CONDUCTOR_TARGET), most severe first. */
export function problemsFor(problems: readonly OrchestraProblem[], target: string): OrchestraProblem[] {
  const rank: Record<ProblemSeverity, number> = { error: 0, warning: 1, info: 2 };
  return problems
    .filter((p) => (target === CONDUCTOR_TARGET ? p.conductor : p.roleId === target))
    .sort((a, b) => rank[a.severity] - rank[b.severity]);
}

