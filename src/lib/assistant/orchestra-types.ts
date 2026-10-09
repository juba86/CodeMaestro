// Client-safe contract for the orchestra configuration — the "org chart" that
// decides which model plays which role when the orchestrator splits a task.
// Shared by the server (planning, execution, persistence) and the interactive
// chart in the UI, so this module must not import anything server-side.

// --- Types ------------------------------------------------------------------------

export const ORCHESTRA_PRESETS = ["quality", "balanced", "local"] as const;
export type OrchestraPresetId = (typeof ORCHESTRA_PRESETS)[number];
export const ORCHESTRA_PRESET_VALUES = [...ORCHESTRA_PRESETS, "custom"] as const;
export type OrchestraPreset = (typeof ORCHESTRA_PRESET_VALUES)[number];

export const ORCHESTRA_PRESET_LABELS: Record<OrchestraPreset, string> = {
  quality: "Qualität",
  balanced: "Ausgewogen",
  local: "Lokal & günstig",
  custom: "Eigene Besetzung",
};

/** Limits shared with the zod schemas (validation/schemas.ts). */
export const ORCHESTRA_LIMITS = {
  roles: 12,
  roleId: 40,
  name: 60,
  description: 1000,
  instructions: 8000,
  workerId: 220, // "pi:" / "ollama:" + Ollama ids of up to 200 chars
  maxRounds: 3,
} as const;

/** Role ids are slugs: lowercase letters, digits, "-" and "_". */
export const ROLE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

export interface ReviewLoopConfig {
  enabled: boolean;
  /** The role that reviews this role's subtasks. */
  reviewerRoleId: string;
  /** Review rounds (1-3); every "changes" verdict before the last round triggers a fix round. */
  maxRounds: number;
}

export interface OrchestraRole {
  /** Stable slug, referenced by plans (PlannedSubtask.roleId). */
  id: string;
  /** German display name; also used in the role framing of prompts. */
  name: string;
  /** What the role does — shown in the chart and offered to the planner. */
  description: string;
  /** Guidance prepended to every subtask this role runs. */
  instructions: string;
  /** "" = Auto: picked from the available workers at run time. */
  workerId: string;
  /** The role is expected to change files (needs a file-capable worker). */
  editsFiles: boolean;
  enabled: boolean;
  reviewLoop: ReviewLoopConfig;
}

export interface OrchestraConductor {
  /** Plans and summarizes; "" = Auto. */
  workerId: string;
  /** Extra guidance appended to the planner and summary prompts. */
  instructions: string;
}

export interface OrchestraConfig {
  version: 1;
  conductor: OrchestraConductor;
  roles: OrchestraRole[];
  /** Which preset the assignments came from; "custom" once edited by hand. */
  preset: OrchestraPreset;
}

/** Client-visible capabilities of a worker (POST /api/assistant/orchestrate/workers). */
export interface OrchestraWorkerInfo {
  id: string;
  kind: string;
  label: string;
  /** Agentic worker with project access that can change files. */
  editsFiles: boolean;
  /** Runs on this machine / the local network (free, offline). */
  local?: boolean;
  model?: string;
  strengths?: string;
  /** Context window in tokens, when known (local models). */
  contextWindow?: number;
}

export type ReviewVerdict = "pass" | "changes" | "unknown";

// --- Defaults ---------------------------------------------------------------------

export const DEFAULT_ROLES: readonly OrchestraRole[] = [
  {
    id: "architekt",
    name: "Architekt",
    description: "Plant Struktur, Schnittstellen und Reihenfolge der Änderungen, bevor Code entsteht. Ändert keine Dateien.",
    instructions:
      "Design the approach before anyone writes code. Read the relevant code first so the design fits what already exists, then name the files and modules involved, the interfaces and data shapes between them, and the order of the changes. Keep the design as small as the task allows and point out trade-offs where a choice matters. You plan only — the coder implements — so leave the files unchanged. Done when the plan lists concrete files, interfaces and steps that a coder can follow without guessing.",
    workerId: "",
    editsFiles: false,
    enabled: true,
    reviewLoop: { enabled: false, reviewerRoleId: "reviewer", maxRounds: 1 },
  },
  {
    id: "coder",
    name: "Coder",
    description: "Setzt Änderungen im Projekt um und prüft sie mit Typecheck, Linter oder Tests.",
    instructions:
      "Implement the subtask in the working directory. Read the surrounding code first and follow its conventions, so the change fits in naturally. Make the smallest complete change that meets the requirements and leave unrelated code as it is. Verify your work before you finish: run the relevant type check, linter or tests when the project has them, and fix what fails. Done when the requirement is implemented and your checks pass; end with a short summary of the changed files and how you verified them.",
    workerId: "",
    editsFiles: true,
    enabled: true,
    reviewLoop: { enabled: true, reviewerRoleId: "reviewer", maxRounds: 2 },
  },
  {
    id: "reviewer",
    name: "Reviewer",
    description: "Prüft Ergebnisse mit frischem Blick auf Korrektheit und Anforderungen und meldet nur relevante Lücken mit Datei und Zeile.",
    instructions:
      "Review the work with fresh eyes, as if you had not seen how it was made. Check it against the stated requirements and the actual code — read the changed files rather than trusting the author's summary. Report only gaps that affect correctness or the requirements (bugs, missing pieces, broken edge cases, security problems), each with file and line and a concrete fix. Leave out style preferences, so the author can focus on what matters. You review only, so leave the files unchanged. End with exactly one final line: <verdict>pass</verdict> when nothing blocking remains, or <verdict>changes</verdict> when the author needs to fix something.",
    workerId: "",
    editsFiles: false,
    enabled: true,
    reviewLoop: { enabled: false, reviewerRoleId: "", maxRounds: 1 },
  },
  {
    id: "tester",
    name: "Tester",
    description: "Schreibt und startet Tests für neue oder geänderte Funktionen.",
    instructions:
      "Make sure the change is covered by tests that pass. Use the project's existing test framework and patterns, and add focused tests for the new behaviour and its edge cases. Run the relevant tests (and the type check where available) and fix the tests you introduced until they pass. When a test reveals a real bug in the implementation, describe it precisely instead of weakening the test, because a green run that hides a bug helps nobody. Done when the tests run green; report which tests you added and the command you ran.",
    workerId: "",
    editsFiles: true,
    enabled: true,
    reviewLoop: { enabled: false, reviewerRoleId: "reviewer", maxRounds: 1 },
  },
  {
    id: "recherche",
    name: "Recherche",
    description: "Liest Code, Konfiguration und Dokumentation und fasst die Fakten mit Fundstellen zusammen. Ändert keine Dateien.",
    instructions:
      "Gather the facts the team needs: read the relevant code, configuration and documentation and answer the question at hand. Summarize what you found with file paths (and line numbers where useful), so others can act on it without repeating the search. Keep what you verified apart from what you infer. You research only, so leave the files unchanged.",
    workerId: "",
    editsFiles: false,
    enabled: true,
    reviewLoop: { enabled: false, reviewerRoleId: "reviewer", maxRounds: 1 },
  },
  {
    id: "doku",
    name: "Doku",
    description: "Aktualisiert README, Dokumentation und Kommentare passend zur Änderung.",
    instructions:
      "Update the documentation to match the change: the README, docs pages and code comments that describe the affected behaviour. Match the tone, language and structure of each document, and document what exists rather than plans. Keep it accurate and concise. Done when the docs describe the current behaviour; list the files you updated.",
    workerId: "",
    editsFiles: true,
    enabled: false,
    reviewLoop: { enabled: false, reviewerRoleId: "reviewer", maxRounds: 1 },
  },
];

function cloneRole(r: OrchestraRole): OrchestraRole {
  return { ...r, reviewLoop: { ...r.reviewLoop } };
}

/** A fresh copy of the default configuration (every assignment on Auto). */
export function defaultOrchestraConfig(): OrchestraConfig {
  return {
    version: 1,
    conductor: { workerId: "", instructions: "" },
    roles: DEFAULT_ROLES.map(cloneRole),
    preset: "custom",
  };
}

/** A unique role id derived from a display name ("Übersetzer" → "uebersetzer"). */
export function slugifyRoleId(name: string, taken: Iterable<string> = []): string {
  const base =
    name
      .toLowerCase()
      .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, ORCHESTRA_LIMITS.roleId - 4)
      .replace(/-+$/, "") || "rolle";
  const used = new Set(taken);
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  return id;
}

// --- Local model ranking ----------------------------------------------------------

export const CODER_MODEL = /coder|codestral|devstral|codellama|codegemma|starcoder/i;
const NON_GENERAL_LOCAL = /embed|bge|rerank|guard|whisper|tts/i;
// Strong general local models, best first. Installed models from this list win;
// otherwise the largest remaining general model (by parameter count) is used.
// An exact tag match beats a prefix match, so "qwen3.8:27b" is picked over the
// heavier "qwen3.8:27b-q8_0" quant that would spill out of VRAM.
const GENERAL_PRIORITY = [
  "qwen3.8:27b", "qwen3.6:35b", "gemma4:31b", "nemotron3", "nemotron-cascade",
  "qwen3.6:27b", "mistral-small3.2", "glm-4.7-flash", "gemma4:26b", "gemma4:12b", "phi4",
];

/** Parameter count in billions from Ollama's "(35B)" name suffix or a ":35b" tag. */
export function paramBillions(m: { id: string; name?: string }): number {
  const fromName = m.name?.match(/\((\d+(?:\.\d+)?)\s*([BM])\)\s*$/i);
  if (fromName) return Number(fromName[1]) / (fromName[2].toUpperCase() === "M" ? 1000 : 1);
  const fromId = m.id.match(/(\d+(?:\.\d+)?)b\b/i);
  return fromId ? Number(fromId[1]) : 0;
}

/** A general chat model (not a coder, embedding, guard or audio model). */
export function isGeneralLocal(id: string): boolean {
  return !CODER_MODEL.test(id) && !NON_GENERAL_LOCAL.test(id);
}

function priority(id: string): number {
  const exact = GENERAL_PRIORITY.indexOf(id);
  if (exact >= 0) return exact;
  const i = GENERAL_PRIORITY.findIndex((p) => id.startsWith(p));
  return i < 0 ? GENERAL_PRIORITY.length : i + 0.5;
}

/**
 * Context window in tokens, from the model's reported `contextWindow` or a
 * "-64k"/"-256k" tag suffix (Ollama variants that only differ in num_ctx);
 * 0 when unknown.
 */
export function contextTokens(m: { id: string; contextWindow?: number }): number {
  if (typeof m.contextWindow === "number" && m.contextWindow > 0) return m.contextWindow;
  const k = m.id.match(/[-_:](\d+)k$/i);
  return k ? Number(k[1]) * 1024 : 0;
}

/**
 * Among otherwise equal variants of one model, the SMALLER context wins:
 * planning and summaries fit comfortably in 64k, while a 256k variant books
 * a KV cache several times larger — on a shared GPU it is the first to be
 * evicted, and every reload costs minutes of prompt re-processing.
 */
function smallerContextFirst(a: { id: string; contextWindow?: number }, b: { id: string; contextWindow?: number }): number {
  return contextTokens(a) - contextTokens(b);
}

/** The strongest general (non-coder, non-embedding) local model, if any. */
export function strongestGeneral<T extends { id: string; name?: string; contextWindow?: number }>(models: T[]): T | undefined {
  return models
    .filter((m) => isGeneralLocal(m.id))
    .sort(
      (a, b) =>
        priority(a.id) - priority(b.id) ||
        paramBillions(b) - paramBillions(a) ||
        smallerContextFirst(a, b) ||
        a.id.localeCompare(b.id)
    )[0];
}

// --- Worker ranking ---------------------------------------------------------------

export function isLocalWorker(w: OrchestraWorkerInfo): boolean {
  return w.local ?? (w.kind === "ollama" || w.kind === "pi");
}

/**
 * Capability tier, higher is stronger: Claude Code > Gemini CLI > cloud APIs >
 * local models (plain Ollama chat and pi agents alike — editing roles pick the
 * file-capable ones by capability).
 */
export function workerTier(w: OrchestraWorkerInfo): number {
  if (w.kind === "claude-cli") return 3;
  if (w.kind === "gemini-cli") return 2;
  return isLocalWorker(w) ? 0 : 1;
}

const modelId = (w: OrchestraWorkerInfo) => w.model || w.id;

/**
 * The strongest worker of a set: highest tier first; within a tier, the known
 * strong general models, then larger models, then the given order.
 * `generalFirst` ranks coder/embedding models last (for text roles).
 */
export function strongestWorker<W extends OrchestraWorkerInfo>(workers: W[], generalFirst = false): W | undefined {
  return [...workers].sort((a, b) => {
    const ma = modelId(a);
    const mb = modelId(b);
    return (
      workerTier(b) - workerTier(a) ||
      (generalFirst ? Number(!isGeneralLocal(ma)) - Number(!isGeneralLocal(mb)) : 0) ||
      priority(ma) - priority(mb) ||
      paramBillions({ id: mb }) - paramBillions({ id: ma }) ||
      smallerContextFirst({ id: ma, contextWindow: a.contextWindow }, { id: mb, contextWindow: b.contextWindow }) ||
      // Deterministic: never depends on the order Ollama lists its tags in.
      ma.localeCompare(mb)
    );
  })[0];
}

/** The strongest worker that can change files (`canEdit` defaults to the worker's flag). */
export function bestFileWorker<W extends OrchestraWorkerInfo>(
  workers: W[],
  canEdit: (w: W) => boolean = (w) => w.editsFiles
): W | undefined {
  return strongestWorker(workers.filter(canEdit));
}

/**
 * Auto pick for the conductor (planning + summary): Claude Code > Gemini CLI >
 * the strongest general local text model > a cloud API > anything left.
 */
export function autoConductor<W extends OrchestraWorkerInfo>(workers: W[]): W | undefined {
  const localText = workers.filter((w) => isLocalWorker(w) && !w.editsFiles);
  return (
    workers.find((w) => w.kind === "claude-cli") ??
    workers.find((w) => w.kind === "gemini-cli") ??
    strongestGeneral(localText.map((w) => ({ id: modelId(w), w })))?.w ??
    workers.find((w) => !isLocalWorker(w) && !w.editsFiles) ??
    workers[0]
  );
}

export interface WorkerAssignment<W> {
  worker: W | null;
  /** Picked automatically (nothing configured, or the configured worker is unavailable). */
  auto: boolean;
  /** A worker was configured but is not available. */
  unavailable: boolean;
}

export interface ResolveOptions<W> {
  /** Session-aware file capability (default: the worker's editsFiles flag). */
  canEdit?: (w: W) => boolean;
  /** Worker lookup by id (default: exact match in the list). */
  find?: (id: string) => W | null | undefined;
  /** The conductor's worker, used for Auto text roles (default: autoConductor). */
  conductor?: W | null;
}

function lookup<W extends OrchestraWorkerInfo>(workers: W[], id: string, find?: ResolveOptions<W>["find"]): W | null {
  return (find ? find(id) : workers.find((w) => w.id === id)) ?? null;
}

/** The configured worker id, or "" for Auto ("" and "auto" both mean Auto). */
function configuredId(workerId: string): string {
  const id = workerId.trim();
  return id === "auto" ? "" : id;
}

/** The conductor's worker: the configured one when available, else Auto. */
export function resolveConductor<W extends OrchestraWorkerInfo>(
  workers: W[],
  workerId: string,
  find?: ResolveOptions<W>["find"]
): WorkerAssignment<W> {
  const id = configuredId(workerId);
  const found = id ? lookup(workers, id, find) : null;
  if (found) return { worker: found, auto: false, unavailable: false };
  return { worker: autoConductor(workers) ?? null, auto: true, unavailable: !!id };
}

/**
 * The worker that runs a role: the configured one when available; otherwise
 * Auto — the strongest file-capable worker for roles that change files, and
 * the conductor's model for the others (or when nothing can change files).
 */
export function resolveRoleWorker<W extends OrchestraWorkerInfo>(
  role: Pick<OrchestraRole, "workerId" | "editsFiles">,
  workers: W[],
  opts: ResolveOptions<W> = {}
): WorkerAssignment<W> {
  const id = configuredId(role.workerId);
  const configured = id ? lookup(workers, id, opts.find) : null;
  if (configured) return { worker: configured, auto: false, unavailable: false };
  const conductor = opts.conductor !== undefined ? opts.conductor : autoConductor(workers) ?? null;
  const worker = (role.editsFiles ? bestFileWorker(workers, opts.canEdit) : undefined) ?? conductor ?? null;
  return { worker, auto: true, unavailable: !!id };
}

// --- Review loop ------------------------------------------------------------------

/** The reviewer role for `role` when its review loop can run (reviewer exists, is enabled and is another role). */
export function reviewerFor(config: Pick<OrchestraConfig, "roles">, role: OrchestraRole): OrchestraRole | null {
  const loop = role.reviewLoop;
  if (!loop?.enabled || !loop.reviewerRoleId || loop.reviewerRoleId === role.id) return null;
  const reviewer = config.roles.find((r) => r.id === loop.reviewerRoleId);
  return reviewer?.enabled ? reviewer : null;
}

export function clampRounds(n: number): number {
  return Math.min(ORCHESTRA_LIMITS.maxRounds, Math.max(1, Math.floor(n) || 1));
}

const VERDICT_RE = /<verdict>\s*(pass|changes)\s*<\/verdict>/gi;

/** The reviewer's verdict — the last <verdict>…</verdict> tag in the text. */
export function parseVerdict(text: string): ReviewVerdict {
  let verdict: ReviewVerdict = "unknown";
  for (const m of text.matchAll(VERDICT_RE)) verdict = m[1].toLowerCase() as ReviewVerdict;
  return verdict;
}

// --- Validation -------------------------------------------------------------------

export const NO_MODEL_WARNING =
  "Kein Modell verfügbar: weder Claude Code noch Gemini CLI gefunden, keine lokalen Modelle installiert und keine Cloud-API eingerichtet.";

/** Local models exist, but none can change files (pi missing, or no model with tool calling). */
export const NO_LOCAL_AGENT_HINT =
  "Lokale Modelle ändern Dateien über den pi coding agent — pi installieren (Einstellungen → Lokale Modelle (pi)) und ein Ollama-Modell mit Tool-Unterstützung herunterladen.";

const quoted = (role: OrchestraRole) => `„${role.name || role.id}“`;

/**
 * Checks a configuration against the available workers and returns German
 * warnings for the chart. Nothing here blocks saving or running: unavailable
 * assignments fall back to Auto ("Automatisch") at run time.
 */
export function validateOrchestra(config: OrchestraConfig, workers: OrchestraWorkerInfo[]): string[] {
  const out: string[] = [];
  const enabled = config.roles.filter((r) => r.enabled);

  // Structure (independent of the available models).
  const seen = new Set<string>();
  for (const r of config.roles) {
    if (seen.has(r.id)) out.push(`Rollen-ID „${r.id}“ kommt mehrfach vor — jede Rolle braucht eine eigene ID.`);
    seen.add(r.id);
  }
  if (!enabled.length) {
    out.push("Keine Rolle aktiv — der Dirigent verteilt die Teilaufgaben direkt an die Modelle.");
  }
  for (const role of enabled) {
    const loop = role.reviewLoop;
    if (!loop.enabled) continue;
    const reviewer = config.roles.find((r) => r.id === loop.reviewerRoleId);
    if (!reviewer) {
      out.push(`Die Prüfschleife von ${quoted(role)} zeigt auf eine Rolle, die es nicht gibt („${loop.reviewerRoleId || "—"}“).`);
    } else if (reviewer.id === role.id) {
      out.push(`${quoted(role)} kann sich nicht selbst prüfen — wähle eine andere Rolle für die Prüfschleife.`);
    } else if (!reviewer.enabled) {
      out.push(`Die prüfende Rolle ${quoted(reviewer)} für ${quoted(role)} ist deaktiviert — die Prüfschleife wird übersprungen.`);
    }
  }

  // Assignments.
  if (!workers.length) return [NO_MODEL_WARNING, ...out];
  const conductorId = config.conductor.workerId.trim();
  const conductor = resolveConductor(workers, conductorId);
  if (conductor.unavailable) out.push(`Dirigent: Modell „${conductorId}“ ist nicht verfügbar — stattdessen wird automatisch gewählt.`);
  for (const role of enabled) {
    const r = resolveRoleWorker(role, workers, { conductor: conductor.worker });
    if (r.unavailable) out.push(`Rolle ${quoted(role)}: Modell „${role.workerId.trim()}“ ist nicht verfügbar — stattdessen wird automatisch gewählt.`);
    if (!r.worker) {
      out.push(`Kein Modell verfügbar für Rolle ${quoted(role)}.`);
    } else if (role.editsFiles && !r.worker.editsFiles) {
      out.push(
        r.auto
          ? `Kein Modell mit Dateizugriff verfügbar für Rolle ${quoted(role)} — ${r.worker.label} liefert nur Text, Dateien bleiben unverändert.`
          : `Rolle ${quoted(role)} soll Dateien ändern, aber ${r.worker.label} kann keine Dateien bearbeiten — beim Start übernimmt ein Modell mit Dateizugriff, falls eines verfügbar ist.`
      );
    }
  }
  return out;
}

// --- Presets ----------------------------------------------------------------------

export interface PresetResult {
  config: OrchestraConfig;
  warnings: string[];
}

// Roles that keep the strongest model in the "balanced" preset (designing and
// judging — plus every role that reviews another one); every other role runs
// on a cheaper/faster worker where one exists.
const BALANCED_STRONG_ROLES = new Set(["architekt", "reviewer"]);

/**
 * Assigns workers for a preset, computed from the discovered workers:
 * - quality: the strongest available model everywhere (Claude Code > Gemini CLI > API > local);
 * - balanced: strongest for conductor, architect and reviewing roles; the other roles
 *   on a cheaper file-capable worker below the top tier (Gemini CLI, a local
 *   agent) when one exists;
 * - local: local models only — text models for text roles, file-capable local
 *   workers (pi agents) for roles that change files.
 * Picks are by capability (editsFiles/local), not by worker kind. When nothing
 * fits, the assignment falls back to Auto with a warning. `base` keeps the
 * user's roles and instructions and only reassigns the workers.
 */
export function buildPreset(
  preset: OrchestraPresetId,
  workers: OrchestraWorkerInfo[],
  base: OrchestraConfig = defaultOrchestraConfig()
): PresetResult {
  const warnings: string[] = [];
  const fileWorkers = workers.filter((w) => w.editsFiles);
  const local = workers.filter(isLocalWorker);
  const localFiles = local.filter((w) => w.editsFiles);
  const localText = local.filter((w) => !w.editsFiles);

  const strongest = (editsFiles: boolean) =>
    editsFiles ? strongestWorker(fileWorkers) : strongestWorker(workers, true);
  const cheaper = (editsFiles: boolean) => {
    const top = strongestWorker(fileWorkers);
    const below = top ? strongestWorker(fileWorkers.filter((w) => workerTier(w) < workerTier(top))) : undefined;
    return below ?? strongest(editsFiles);
  };
  const pick = (editsFiles: boolean, strong: boolean): OrchestraWorkerInfo | undefined => {
    switch (preset) {
      case "quality":
        return strongest(editsFiles);
      case "balanced":
        return strong ? strongest(editsFiles) : cheaper(editsFiles);
      case "local":
        return editsFiles
          ? strongestWorker(localFiles)
          : strongestWorker(localText, true) ?? strongestWorker(localFiles);
    }
  };

  const scope = preset === "local" ? "lokales " : "";
  const conductor = preset === "local"
    ? strongestWorker(localText, true) ?? strongestWorker(localFiles)
    : strongestWorker(workers, true);
  if (!conductor && workers.length) {
    warnings.push(`Kein ${scope}Modell für den Dirigenten verfügbar — Zuweisung auf Automatisch gesetzt.`);
  }

  const reviewerIds = new Set(base.roles.filter((r) => r.enabled).map((r) => reviewerFor(base, r)?.id));
  const roles = base.roles.map((role): OrchestraRole => {
    const w = pick(role.editsFiles, BALANCED_STRONG_ROLES.has(role.id) || reviewerIds.has(role.id));
    if (!w && role.enabled && workers.length) {
      warnings.push(
        role.editsFiles
          ? `Kein ${scope}Modell mit Dateizugriff für Rolle ${quoted(role)} verfügbar — Zuweisung auf Automatisch gesetzt.`
          : `Kein ${scope}Modell für Rolle ${quoted(role)} verfügbar — Zuweisung auf Automatisch gesetzt.`
      );
    }
    return { ...cloneRole(role), workerId: w?.id ?? "" };
  });

  const config: OrchestraConfig = {
    version: 1,
    conductor: { ...base.conductor, workerId: conductor?.id ?? "" },
    roles,
    preset,
  };
  const editingRole = roles.some((r) => r.enabled && r.editsFiles);
  if (preset === "local" && editingRole && localText.length && !localFiles.length) warnings.push(NO_LOCAL_AGENT_HINT);
  for (const w of validateOrchestra(config, workers)) if (!warnings.includes(w)) warnings.push(w);
  return { config, warnings };
}
