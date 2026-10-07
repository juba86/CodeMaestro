// Pure derivations for the orchestra org chart (DESIGN.md §6.3): columns,
// icons, preset labels and worker display helpers. Client-safe, no React state.

import {
  Code,
  Compass,
  Database,
  FileText,
  FlaskConical,
  Palette,
  ScanEye,
  Search,
  Shield,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import {
  ORCHESTRA_PRESET_LABELS,
  isLocalWorker,
  resolveConductor,
  resolveRoleWorker,
  slugifyRoleId,
  workerTier,
  type OrchestraConfig,
  type OrchestraPresetId,
  type OrchestraRole,
  type OrchestraWorkerInfo,
} from "@/lib/assistant/orchestra-types";

// --- Columns ----------------------------------------------------------------------

/** Planen → Umsetzen → Prüfen. A derived view: the backend stores no section. */
export type OrchestraColumn = "plan" | "build" | "review";

export const ORCHESTRA_COLUMNS: readonly OrchestraColumn[] = ["plan", "build", "review"];

export const COLUMN_LABEL: Record<OrchestraColumn, string> = {
  plan: "Planen",
  build: "Umsetzen",
  review: "Prüfen",
};

/**
 * The column a role sits in (§6.3):
 * - Prüfen: it reviews at least one other enabled role's enabled Prüfschleife;
 * - Umsetzen: otherwise, it may change files;
 * - Planen: everything else (read-only roles).
 */
export function columnOf(role: OrchestraRole, config: Pick<OrchestraConfig, "roles">): OrchestraColumn {
  const reviews = config.roles.some(
    (r) => r.id !== role.id && r.enabled && r.reviewLoop.enabled && r.reviewLoop.reviewerRoleId === role.id
  );
  if (reviews) return "review";
  return role.editsFiles ? "build" : "plan";
}

/** Roles per column, each in `config.roles` order. */
export function rolesByColumn(config: Pick<OrchestraConfig, "roles">): Record<OrchestraColumn, OrchestraRole[]> {
  const out: Record<OrchestraColumn, OrchestraRole[]> = { plan: [], build: [], review: [] };
  for (const role of config.roles) out[columnOf(role, config)].push(role);
  return out;
}

// --- Icons ------------------------------------------------------------------------

const ROLE_ICONS: Record<string, LucideIcon> = {
  architekt: Compass,
  coder: Code,
  reviewer: ScanEye,
  tester: FlaskConical,
  recherche: Search,
  doku: FileText,
  sicherheit: Shield,
  frontend: Palette,
  datenbank: Database,
};

// Common synonyms (English names, long forms) for hand-made roles.
const ROLE_ALIASES: Record<string, string> = {
  architect: "architekt",
  architektur: "architekt",
  entwickler: "coder",
  developer: "coder",
  code: "coder",
  review: "reviewer",
  pruefer: "reviewer",
  test: "tester",
  tests: "tester",
  qa: "tester",
  research: "recherche",
  docs: "doku",
  dokumentation: "doku",
  documentation: "doku",
  security: "sicherheit",
  ui: "frontend",
  database: "datenbank",
  db: "datenbank",
};

/** "coder-2" → "coder"; aliases resolved. */
function iconKey(slug: string): string | null {
  const base = slug.replace(/-\d+$/, "");
  for (const key of [slug, base]) {
    if (ROLE_ICONS[key]) return key;
    if (ROLE_ALIASES[key]) return ROLE_ALIASES[key];
  }
  return null;
}

/** The icon for a role (§6.3 table): matched by id first, then by name; UserRound otherwise. */
export function roleIcon(role: { id?: string | null; name?: string | null } | null | undefined): LucideIcon {
  const byId = role?.id ? iconKey(role.id.trim().toLowerCase()) : null;
  if (byId) return ROLE_ICONS[byId];
  const name = role?.name?.trim();
  const byName = name ? iconKey(slugifyRoleId(name)) : null;
  return byName ? ROLE_ICONS[byName] : UserRound;
}

// --- Presets ----------------------------------------------------------------------

/**
 * The Besetzung label: „Qualität" · „Ausgewogen" · „Lokal & günstig" ·
 * „Eigene Besetzung"; a hand-edited preset (client-side memory `basedOn`)
 * reads „Ausgewogen · geändert".
 */
export function presetLabel(
  config: Pick<OrchestraConfig, "preset"> | null | undefined,
  basedOn?: OrchestraPresetId | null
): string {
  const preset = config?.preset ?? "custom";
  if (preset !== "custom") return ORCHESTRA_PRESET_LABELS[preset];
  if (basedOn) return `${ORCHESTRA_PRESET_LABELS[basedOn]} · geändert`;
  return ORCHESTRA_PRESET_LABELS.custom;
}

// --- Workers ----------------------------------------------------------------------

export type CostHint = "stark" | "frei per Login" | "lokal" | "API";

/** Short tier hint for model chips: „stark" (Claude Code), „frei per Login" (Gemini CLI), „lokal", „API". */
export function costHint(worker: OrchestraWorkerInfo): CostHint {
  if (workerTier(worker) >= 3) return "stark";
  if (worker.kind === "gemini-cli") return "frei per Login";
  if (isLocalWorker(worker)) return "lokal";
  return "API";
}

export type WorkerGroupId = "agents" | "local-text" | "cloud-text";

export const WORKER_GROUP_LABEL: Record<WorkerGroupId, string> = {
  agents: "Agenten · dürfen Dateien ändern",
  "local-text": "Nur Text · lokal",
  "cloud-text": "Nur Text · Cloud-API",
};

export function workerGroupOf(worker: OrchestraWorkerInfo): WorkerGroupId {
  if (worker.editsFiles) return "agents";
  return isLocalWorker(worker) ? "local-text" : "cloud-text";
}

export interface WorkerGroup {
  id: WorkerGroupId;
  label: string;
  workers: OrchestraWorkerInfo[];
}

/** Palette groups in fixed order; empty groups are left out. Workers keep their order. */
export function groupWorkers(workers: readonly OrchestraWorkerInfo[]): WorkerGroup[] {
  const groups: WorkerGroup[] = (["agents", "local-text", "cloud-text"] as const).map((id) => ({
    id,
    label: WORKER_GROUP_LABEL[id],
    workers: [],
  }));
  for (const w of workers) groups.find((g) => g.id === workerGroupOf(w))!.workers.push(w);
  return groups.filter((g) => g.workers.length > 0);
}

/** How often each worker id is assigned: the Dirigent plus every enabled role. */
export function usageCounts(config: Pick<OrchestraConfig, "conductor" | "roles">): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (id: string) => {
    const key = id.trim();
    if (!key || key === "auto") return;
    out[key] = (out[key] ?? 0) + 1;
  };
  add(config.conductor.workerId);
  for (const r of config.roles) if (r.enabled) add(r.workerId);
  return out;
}

/** Display parts of a worker: a name and an optional detail („pi" · „qwen3-coder:30b"). */
export function workerParts(worker: OrchestraWorkerInfo): { name: string; detail: string } {
  const model = (worker.model ?? "").trim();
  switch (worker.kind) {
    case "claude-cli":
      return { name: "Claude Code", detail: model };
    case "gemini-cli":
      return { name: "Gemini CLI", detail: model };
    case "pi":
      return { name: "pi", detail: model || worker.label.replace(/^pi\s*·\s*/, "") };
    case "ollama":
      return { name: model || worker.label.replace(/^Local:\s*/i, ""), detail: "" };
    case "api":
      return { name: worker.label.replace(/^API:\s*/i, ""), detail: model };
    default:
      return { name: worker.label || worker.id, detail: model };
  }
}

/** „Claude Code", „pi · qwen3-coder:30b", „qwen3:14b", „OpenAI". */
export function workerLabel(worker: OrchestraWorkerInfo): string {
  const { name, detail } = workerParts(worker);
  return detail ? `${name} · ${detail}` : name;
}

/** The most specific part, for compact messages: „gpt-5-mini", „qwen3:14b", „Claude Code". */
export function workerShortLabel(worker: OrchestraWorkerInfo): string {
  const { name, detail } = workerParts(worker);
  return detail || name;
}

const CODER_RE = /coder|codestral|devstral|codellama|codegemma|starcoder/i;

/** One German line about a worker for pickers (the backend `strengths` are English planner text). */
export function workerBlurb(worker: OrchestraWorkerInfo): string {
  const model = worker.model || worker.id;
  switch (worker.kind) {
    case "claude-cli":
      return "Stärkstes Modell · Agent";
    case "gemini-cli":
      return "Großer Kontext · Agent";
    case "pi":
      return CODER_RE.test(model) ? "Lokaler Agent über pi · Coding" : "Lokaler Agent über pi";
    case "ollama":
      return CODER_RE.test(model) ? "Lokal über Ollama · Coding · nur Text" : "Lokal über Ollama · nur Text";
    case "api":
      return isLocalWorker(worker) ? "Eigener Endpunkt · nur Text" : "Cloud-API · nur Text";
    default:
      return worker.editsFiles ? "Agent" : "nur Text";
  }
}

export function findWorker(
  workers: readonly OrchestraWorkerInfo[] | null | undefined,
  id: string | null | undefined
): OrchestraWorkerInfo | null {
  const key = (id ?? "").trim();
  if (!key || !workers) return null;
  return workers.find((w) => w.id === key) ?? null;
}

export interface AssignmentView {
  /** The worker that runs it (configured, or Auto's pick); null when unknown. */
  worker: OrchestraWorkerInfo | null;
  /** Automatisch (nothing configured, or the configured model is unavailable). */
  auto: boolean;
  /** A model is configured but not available. */
  unavailable: boolean;
  /** The configured id ("" = Automatisch). */
  configuredId: string;
  /** „Claude Code · Sonnet", „Automatisch · Claude Code", „Automatisch". */
  label: string;
}

function assignmentView(configuredId: string, r: { worker: OrchestraWorkerInfo | null; auto: boolean; unavailable: boolean } | null): AssignmentView {
  if (!r) {
    // Models unknown (loading/failed): show what is configured.
    return { worker: null, auto: !configuredId, unavailable: false, configuredId, label: configuredId || "Automatisch" };
  }
  const label = r.auto
    ? r.worker ? `Automatisch · ${workerLabel(r.worker)}` : "Automatisch"
    : r.worker ? workerLabel(r.worker) : configuredId;
  return { worker: r.worker, auto: r.auto, unavailable: r.unavailable, configuredId, label };
}

/** How the Dirigent is assigned right now (resolveConductor). */
export function conductorAssignment(
  config: Pick<OrchestraConfig, "conductor">,
  workers: readonly OrchestraWorkerInfo[] | null
): AssignmentView {
  const id = config.conductor.workerId.trim();
  // No models at all: one global warning covers it; show what is configured.
  return assignmentView(id, workers?.length ? resolveConductor([...workers], id) : null);
}

/** How a role is assigned right now (resolveRoleWorker with the Dirigent's pick for Auto text roles). */
export function roleAssignment(
  role: Pick<OrchestraRole, "workerId" | "editsFiles">,
  config: Pick<OrchestraConfig, "conductor">,
  workers: readonly OrchestraWorkerInfo[] | null
): AssignmentView {
  const id = role.workerId.trim();
  if (!workers?.length) return assignmentView(id, null);
  const list = [...workers];
  const conductor = resolveConductor(list, config.conductor.workerId).worker;
  return assignmentView(id, resolveRoleWorker(role, list, { conductor }));
}

/** Vendor family used for „second opinion" hints (two pi models are the same family). */
export function workerFamily(worker: OrchestraWorkerInfo): string {
  if (worker.kind === "api") return `api:${worker.id}`;
  if (worker.kind === "pi" || worker.kind === "ollama") return `local:${(worker.model || worker.id).split(/[:/]/)[0]}`;
  return worker.kind;
}

// --- Role templates (add-role popover) ----------------------------------------------

export interface RoleTemplate {
  /** Suggested id base (slugified against the existing ids on insert). */
  id: string;
  name: string;
  description: string;
  instructions: string;
  editsFiles: boolean;
}

/** Extra suggestions besides DEFAULT_ROLES (§6.3.6). Instructions in English like the defaults (prompt text). */
export const EXTRA_ROLE_TEMPLATES: readonly RoleTemplate[] = [
  {
    id: "sicherheit",
    name: "Sicherheit",
    description: "Prüft Änderungen auf Sicherheitslücken wie Injection, fehlende Prüfungen oder geleakte Geheimnisse. Ändert keine Dateien.",
    instructions:
      "Review the work for security problems: injection, missing authorization or input validation, unsafe file or shell access, leaked secrets and risky dependencies. Read the changed code rather than the summary. Report only real, exploitable or clearly risky issues, each with file and line and a concrete fix. You review only, so leave the files unchanged. End with exactly one final line: <verdict>pass</verdict> or <verdict>changes</verdict>.",
    editsFiles: false,
  },
  {
    id: "frontend",
    name: "Frontend",
    description: "Setzt Oberflächen, Komponenten und Styles um und achtet auf Bedienbarkeit und Barrierefreiheit.",
    instructions:
      "Implement the user interface part of the subtask. Follow the project's component library, styling conventions and design tokens, keep the markup accessible (labels, focus, keyboard use, contrast) and make it work on small screens. Verify with the project's type check, linter or tests. Done when the UI works as required; summarize the changed files.",
    editsFiles: true,
  },
  {
    id: "datenbank",
    name: "Datenbank",
    description: "Ändert Schema, Migrationen und Abfragen und achtet auf bestehende Daten.",
    instructions:
      "Handle the database part of the subtask: schema changes, migrations and queries. Follow the project's ORM and migration conventions, keep existing data safe (no destructive migration without a clear reason) and keep queries efficient. Verify by generating/applying migrations or running the relevant tests when available. Done when the change is in place; list the migrations and files you touched.",
    editsFiles: true,
  },
];

/** A role name not taken yet (case-insensitive): „Coder 2", „Neue Rolle 3". */
export function uniqueRoleName(base: string, roles: readonly Pick<OrchestraRole, "name">[]): string {
  const taken = new Set(roles.map((r) => r.name.trim().toLowerCase()));
  const clean = base.trim() || "Neue Rolle";
  if (!taken.has(clean.toLowerCase())) return clean;
  const stem = clean.replace(/\s+\d+$/, "");
  for (let n = 2; ; n++) {
    const candidate = `${stem} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}
