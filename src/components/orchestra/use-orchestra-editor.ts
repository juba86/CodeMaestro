"use client";

// Editor state of the /orchestra page: the draft next to the saved config,
// preset memory, selection, undo toasts, announcements, the sessionStorage
// draft and the save flow (§6.3.5–6.3.7).

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ORCHESTRA_LIMITS,
  ORCHESTRA_PRESET_LABELS,
  type OrchestraConfig,
  type OrchestraPresetId,
  type OrchestraWorkerInfo,
} from "@/lib/assistant/orchestra-types";
import { confirm } from "@/components/ui/confirm";
import { errorMessage } from "./api";
import { COLUMN_LABEL, findWorker, workerLabel, workerShortLabel, type OrchestraColumn, type RoleTemplate } from "./derive";
import {
  CONDUCTOR_TARGET,
  addRole as addRoleOp,
  canonicalConfig,
  changedRoleNames,
  configsEqual,
  duplicateRole as duplicateRoleOp,
  findRole,
  moveRole as moveRoleOp,
  parseConfig,
  removeRole as removeRoleOp,
  renameRole as renameRoleOp,
  restoreRole,
  setWorker,
  updateRole,
  workerIdOf,
} from "./edit";
import { countProblems, deriveProblems, saveBlockedReason, type OrchestraProblem, type OrchestraProblemFix } from "./problems";
import { useOrchestraConfig } from "./use-orchestra-config";

export type Selection = { kind: "conductor" } | { kind: "role"; id: string } | null;

export const DRAFT_KEY = "cm-orchestra-draft";
const UNDO_MS = 6000;

interface StoredDraft {
  v: 1;
  draft: OrchestraConfig;
  basedOn: OrchestraPresetId | null;
  baseline: OrchestraConfig | null;
  /** Canonical JSON of the saved config the draft was made from. */
  base: string;
}

function readStoredDraft(): StoredDraft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<StoredDraft>;
    const draft = parseConfig(v?.draft);
    if (!draft) return null;
    const basedOn = v.basedOn === "quality" || v.basedOn === "balanced" || v.basedOn === "local" ? v.basedOn : null;
    return { v: 1, draft, basedOn, baseline: parseConfig(v.baseline), base: typeof v.base === "string" ? v.base : "" };
  } catch {
    return null;
  }
}

function writeStoredDraft(d: StoredDraft | null) {
  try {
    if (d) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* storage unavailable (private mode, quota) – the draft lives in memory only */
  }
}

const presetIdOf = (c: OrchestraConfig): OrchestraPresetId | null => (c.preset === "custom" ? null : c.preset);
const roleLabel = (c: OrchestraConfig, id: string) =>
  id === CONDUCTOR_TARGET ? "Dirigent" : findRole(c, id)?.name.trim() || id;

export interface OrchestraEditor {
  /** Saved config and draft are known. */
  ready: boolean;
  saved: OrchestraConfig | null;
  draft: OrchestraConfig | null;
  workers: OrchestraWorkerInfo[] | null;
  dirty: boolean;
  /** The preset the draft came from (client memory; cleared on save). */
  basedOn: OrchestraPresetId | null;
  /** „geändert: Tester, Doku" against the preset's assignment. */
  changedNames: string[];
  problems: OrchestraProblem[];
  counts: ReturnType<typeof countProblems>;
  saveBlocked: string | null;
  saving: boolean;
  applyingPreset: OrchestraPresetId | null;
  presetWarnings: string[] | null;
  dismissPresetWarnings: () => void;

  selection: Selection;
  select: (s: Selection) => void;
  renamingId: string | null;
  setRenamingId: (id: string | null) => void;

  /** Polite announcement (aria-live) and a counter so equal texts are re-read. */
  announcement: { text: string; n: number };
  announce: (text: string) => void;

  assign: (target: string, workerId: string) => void;
  updateRole: (roleId: string, patch: Parameters<typeof updateRole>[2]) => void;
  updateConductorInstructions: (instructions: string) => void;
  /** Replaces the draft (fix actions, inspector edits that need edit.ts helpers). */
  apply: (fn: (c: OrchestraConfig) => OrchestraConfig, announce?: string) => void;
  rename: (roleId: string, name: string) => void;
  addRole: (template: RoleTemplate, column?: OrchestraColumn) => string | null;
  removeRole: (roleId: string) => void;
  duplicateRole: (roleId: string) => void;
  moveRole: (roleId: string, dir: -1 | 1) => void;
  toggleEnabled: (roleId: string) => void;
  applyFix: (fix: OrchestraProblemFix) => void;
  applyPreset: (id: OrchestraPresetId) => Promise<void>;
  save: () => Promise<void>;
  discard: (opts?: { confirmFirst?: boolean }) => Promise<void>;
  /** Label of a worker id for messages („Automatisch" for ""). */
  labelOf: (workerId: string, short?: boolean) => string;

  configError: string | null;
  workersError: string | null;
  workersLoading: boolean;
  reload: () => Promise<void>;
  reloadWorkers: () => Promise<void>;
}

export function useOrchestraEditor(): OrchestraEditor {
  const store = useOrchestraConfig();
  const saved = store.config;
  const workers = store.workers;

  const [draft, setDraft] = useState<OrchestraConfig | null>(null);
  const [base, setBase] = useState<OrchestraConfig | null>(null);
  const [basedOn, setBasedOn] = useState<OrchestraPresetId | null>(null);
  const [baseline, setBaseline] = useState<OrchestraConfig | null>(null);
  const [restored, setRestored] = useState<{ changedSaved: boolean } | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState({ text: "", n: 0 });
  const [saving, setSaving] = useState(false);
  const [applyingPreset, setApplyingPreset] = useState<OrchestraPresetId | null>(null);
  const [presetWarnings, setPresetWarnings] = useState<string[] | null>(null);

  // Follow the saved config: initialize (restoring a stored draft), and take
  // over newer saved versions while there are no unsaved changes.
  if (saved && saved !== base) {
    setBase(saved);
    if (draft === null) {
      const stored = readStoredDraft();
      if (stored && !configsEqual(stored.draft, saved)) {
        setDraft(stored.draft);
        setBasedOn(stored.basedOn);
        setBaseline(stored.baseline ?? saved);
        setRestored({ changedSaved: stored.base !== "" && stored.base !== canonicalConfig(saved) });
      } else {
        setDraft(saved);
        setBasedOn(presetIdOf(saved));
        setBaseline(saved);
      }
    } else if (!base || configsEqual(draft, base) || configsEqual(draft, saved)) {
      setDraft(saved);
      setBasedOn(presetIdOf(saved));
      setBaseline(saved);
    }
  }

  // Latest draft for event handlers (also updated synchronously on every commit).
  const latest = useRef<OrchestraConfig | null>(draft);
  useLayoutEffect(() => {
    latest.current = draft;
  }, [draft]);

  const dirty = !!draft && !!saved && !configsEqual(draft, saved);

  // Keep the draft across reloads of this tab; drop it once clean.
  useEffect(() => {
    if (!draft || !saved) return;
    if (configsEqual(draft, saved)) writeStoredDraft(null);
    else writeStoredDraft({ v: 1, draft, basedOn, baseline, base: canonicalConfig(saved) });
  }, [draft, saved, basedOn, baseline]);

  // Warn before closing the tab with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const announce = useCallback((text: string) => {
    setAnnouncement((a) => ({ text, n: a.n + 1 }));
  }, []);

  const commit = useCallback((next: OrchestraConfig) => {
    latest.current = next;
    setDraft(next);
  }, []);

  const apply = useCallback(
    (fn: (c: OrchestraConfig) => OrchestraConfig, message?: string) => {
      const cur = latest.current;
      if (!cur) return;
      const next = fn(cur);
      if (next === cur) return;
      commit(next);
      if (message) announce(message);
    },
    [commit, announce]
  );

  const labelOf = useCallback(
    (workerId: string, short = false) => {
      const id = workerId.trim();
      if (!id) return "Automatisch";
      const w = findWorker(workers, id);
      return w ? (short ? workerShortLabel(w) : workerLabel(w)) : id;
    },
    [workers]
  );

  const assign = useCallback(
    (target: string, workerId: string) => {
      const cur = latest.current;
      if (!cur) return;
      const prev = workerIdOf(cur, target);
      if (prev === undefined || prev.trim() === workerId.trim()) return;
      commit(setWorker(cur, target, workerId));
      const who = roleLabel(cur, target);
      announce(workerId ? `${labelOf(workerId)} ist jetzt ${who}.` : `${who} nutzt jetzt Automatisch.`);
      toast(`${who}: ${labelOf(prev, true)} → ${labelOf(workerId, true)}`, {
        duration: UNDO_MS,
        action: {
          label: "Rückgängig",
          onClick: () => {
            const now = latest.current;
            if (!now || workerIdOf(now, target)?.trim() !== workerId.trim()) return;
            commit(setWorker(now, target, prev));
            announce(`Rückgängig: ${who} nutzt wieder ${labelOf(prev)}.`);
          },
        },
      });
    },
    [commit, announce, labelOf]
  );

  const select = useCallback((s: Selection) => setSelection(s), []);

  const rename = useCallback(
    (roleId: string, name: string) => {
      const cur = latest.current;
      if (!cur) return;
      const before = findRole(cur, roleId)?.name;
      const next = renameRoleOp(cur, roleId, name);
      if (next === cur) return;
      commit(next);
      announce(`Rolle ‚${before}‘ heißt jetzt ‚${name.trim()}‘.`);
    },
    [commit, announce]
  );

  const addRole = useCallback(
    (template: RoleTemplate, column?: OrchestraColumn) => {
      const cur = latest.current;
      if (!cur) return null;
      const r = addRoleOp(cur, template, column);
      if (!r) {
        toast.error(`Maximal ${ORCHESTRA_LIMITS.roles} Rollen.`);
        return null;
      }
      commit(r.config);
      const name = findRole(r.config, r.roleId)!.name;
      const reviews = r.reviews ? `, prüft ${roleLabel(r.config, r.reviews)}` : "";
      announce(`Rolle ‚${name}‘ hinzugefügt – ${COLUMN_LABEL[r.column]}${reviews}.`);
      return r.roleId;
    },
    [commit, announce]
  );

  const removeRole = useCallback(
    (roleId: string) => {
      const cur = latest.current;
      if (!cur) return;
      const r = removeRoleOp(cur, roleId);
      if (!r) return;
      commit(r.config);
      setSelection((s) => (s?.kind === "role" && s.id === roleId ? null : s));
      setRenamingId((id) => (id === roleId ? null : id));
      const name = r.removal.role.name.trim() || roleId;
      announce(`Rolle ‚${name}‘ entfernt.`);
      toast(`Rolle ‚${name}‘ entfernt`, {
        duration: UNDO_MS,
        action: {
          label: "Rückgängig",
          onClick: () => {
            const now = latest.current;
            if (!now) return;
            const next = restoreRole(now, r.removal);
            if (!next) {
              toast.error("Rückgängig nicht möglich – die Rollen-ID ist inzwischen vergeben oder das Limit erreicht.");
              return;
            }
            commit(next);
            announce(`Rolle ‚${name}‘ wiederhergestellt.`);
          },
        },
      });
    },
    [commit, announce]
  );

  const duplicateRole = useCallback(
    (roleId: string) => {
      const cur = latest.current;
      if (!cur) return;
      const r = duplicateRoleOp(cur, roleId);
      if (!r) {
        toast.error(`Maximal ${ORCHESTRA_LIMITS.roles} Rollen.`);
        return;
      }
      commit(r.config);
      announce(`Rolle ‚${findRole(r.config, r.roleId)!.name}‘ angelegt.`);
    },
    [commit, announce]
  );

  const moveRole = useCallback(
    (roleId: string, dir: -1 | 1) => {
      apply((c) => moveRoleOp(c, roleId, dir), `${roleLabel(latest.current!, roleId)} ${dir < 0 ? "nach oben" : "nach unten"} verschoben.`);
    },
    [apply]
  );

  const toggleEnabled = useCallback(
    (roleId: string) => {
      const cur = latest.current;
      const role = cur ? findRole(cur, roleId) : undefined;
      if (!role) return;
      apply(
        (c) => updateRole(c, roleId, { enabled: !role.enabled }),
        `${role.name} ${role.enabled ? "deaktiviert" : "aktiviert"}.`
      );
    },
    [apply]
  );

  const updateRoleCb = useCallback(
    (roleId: string, patch: Parameters<typeof updateRole>[2]) => apply((c) => updateRole(c, roleId, patch)),
    [apply]
  );

  const updateConductorInstructions = useCallback(
    (instructions: string) => apply((c) => ({ ...c, conductor: { ...c.conductor, instructions }, preset: "custom" })),
    [apply]
  );

  const applyFix = useCallback(
    (fix: OrchestraProblemFix) => apply(fix.apply, `${fix.label} – erledigt.`),
    [apply]
  );

  const reset = useCallback(
    (to: OrchestraConfig) => {
      commit(to);
      setBasedOn(presetIdOf(to));
      setBaseline(to);
      setPresetWarnings(null);
      setRenamingId(null);
      setSelection((s) => (s?.kind === "role" && !findRole(to, s.id) ? null : s));
    },
    [commit]
  );

  const discard = useCallback(
    async ({ confirmFirst = true }: { confirmFirst?: boolean } = {}) => {
      if (!saved) return;
      if (
        confirmFirst &&
        !(await confirm({
          title: "Änderungen verwerfen?",
          description: "Deine ungespeicherten Änderungen am Orchester gehen verloren.",
          confirmLabel: "Verwerfen",
          tone: "danger",
        }))
      ) {
        return;
      }
      reset(saved);
      announce("Änderungen verworfen.");
    },
    [saved, reset, announce]
  );

  // Toast once when a stored draft was restored.
  const discardRef = useRef(discard);
  useEffect(() => {
    discardRef.current = discard;
  }, [discard]);
  useEffect(() => {
    if (!restored) return;
    toast("Ungespeicherte Änderungen wiederhergestellt", {
      id: "orchestra-draft-restored",
      description: restored.changedSaved ? "Die gespeicherte Besetzung wurde inzwischen geändert." : undefined,
      duration: 10_000,
      action: { label: "Verwerfen", onClick: () => void discardRef.current({ confirmFirst: false }) },
    });
  }, [restored]);

  const problems = useMemo(() => (draft ? deriveProblems(draft, workers) : []), [draft, workers]);
  const counts = useMemo(() => countProblems(problems), [problems]);
  const saveBlocked = saveBlockedReason(counts);

  const changedNames = useMemo(
    () => (draft && baseline && draft.preset === "custom" && basedOn ? changedRoleNames(baseline, draft) : []),
    [draft, baseline, basedOn]
  );

  const savingRef = useRef(false);
  const save = useCallback(async () => {
    const cur = latest.current;
    if (!cur || !saved || savingRef.current) return;
    if (configsEqual(cur, saved)) return;
    const blocked = saveBlockedReason(countProblems(deriveProblems(cur, workers)));
    if (blocked) {
      announce(`${blocked}.`);
      toast.error(`${blocked}, dann speichern.`);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const result = await store.save(cur);
      const unchangedMeanwhile = latest.current === cur;
      if (unchangedMeanwhile) commit(result);
      setBase(result);
      setBasedOn(presetIdOf(result));
      setBaseline(result);
      setPresetWarnings(null);
      // A failed earlier attempt left a sticky error toast; it is outdated now.
      toast.dismiss("orchestra-save-error");
      toast.success("Gespeichert");
      announce("Orchester gespeichert. Änderungen gelten ab dem nächsten Lauf.");
    } catch (err) {
      const message = errorMessage(err, "Orchester-Konfiguration konnte nicht gespeichert werden.");
      toast.error(message, {
        id: "orchestra-save-error",
        duration: Infinity,
        action: { label: "Erneut versuchen", onClick: () => void saveRef.current() },
      });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [saved, workers, store, commit, announce]);
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const applyPreset = useCallback(
    async (id: OrchestraPresetId) => {
      const cur = latest.current;
      if (!cur || !saved || applyingPreset) return;
      const label = ORCHESTRA_PRESET_LABELS[id];
      if (
        !configsEqual(cur, saved) &&
        !(await confirm({
          title: `Besetzung ‚${label}‘ laden?`,
          description: "Deine ungespeicherten Modell-Zuweisungen werden ersetzt.",
          confirmLabel: "Laden",
        }))
      ) {
        return;
      }
      setApplyingPreset(id);
      try {
        const r = await store.applyPreset(id, latest.current ?? cur);
        commit(r.config);
        setBasedOn(id);
        setBaseline(r.config);
        setPresetWarnings(r.warnings.length ? r.warnings : null);
        announce(
          `Besetzung ‚${label}‘ geladen – noch nicht gespeichert.${r.warnings.length ? ` ${r.warnings.length === 1 ? "1 Hinweis" : `${r.warnings.length} Hinweise`}.` : ""}`
        );
      } catch (err) {
        toast.error(errorMessage(err, "Voreinstellung konnte nicht berechnet werden."));
      } finally {
        setApplyingPreset(null);
      }
    },
    [saved, applyingPreset, store, commit, announce]
  );

  return {
    ready: !!draft && !!saved,
    saved,
    draft,
    workers,
    dirty,
    basedOn,
    changedNames,
    problems,
    counts,
    saveBlocked,
    saving,
    applyingPreset,
    presetWarnings,
    dismissPresetWarnings: () => setPresetWarnings(null),
    selection,
    select,
    renamingId,
    setRenamingId,
    announcement,
    announce,
    assign,
    updateRole: updateRoleCb,
    updateConductorInstructions,
    apply,
    rename,
    addRole,
    removeRole,
    duplicateRole,
    moveRole,
    toggleEnabled,
    applyFix,
    applyPreset,
    save,
    discard,
    labelOf,
    configError: store.error,
    workersError: store.workersError,
    workersLoading: store.workersLoading,
    reload: store.reload,
    reloadWorkers: store.reloadWorkers,
  };
}
