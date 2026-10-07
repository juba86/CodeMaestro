"use client";

// Shared orchestra configuration + model list. One module-level cache serves
// every consumer (the /orchestra page, the assistant's mode menu, settings and
// home), so navigating between them reuses one load instead of re-fetching.

import { useMemo, useSyncExternalStore } from "react";
import type { OrchestraConfig, OrchestraPresetId, OrchestraWorkerInfo } from "@/lib/assistant/orchestra-types";
import { gatherClientProviders } from "@/lib/client-providers";
import {
  errorMessage,
  fetchOrchestraConfig,
  fetchOrchestraWorkers,
  postOrchestraPreset,
  putOrchestraConfig,
} from "./api";

export interface OrchestraConfigSnapshot {
  /** The saved configuration (null until the first successful load). */
  config: OrchestraConfig | null;
  /** Available models (null until known: loading or failed). */
  workers: OrchestraWorkerInfo[] | null;
  configLoading: boolean;
  workersLoading: boolean;
  /** German error of the last config load (null when fine). */
  configError: string | null;
  workersError: string | null;
}

export interface UseOrchestraConfigResult {
  config: OrchestraConfig | null;
  workers: OrchestraWorkerInfo[] | null;
  /** True until both the configuration and the model list are known (or failed). */
  loading: boolean;
  /** The configuration could not be loaded (editing must be disabled). */
  error: string | null;
  workersLoading: boolean;
  workersError: string | null;
  /** Re-fetches configuration and models. */
  reload: () => Promise<void>;
  /** Re-checks the models only („Neu prüfen"). */
  reloadWorkers: () => Promise<void>;
  /** PUT /api/orchestra; resolves with the saved config, rejects with the server's German message. */
  save: (config: OrchestraConfig) => Promise<OrchestraConfig>;
  /** POST /api/orchestra/preset with the current config; does NOT save. */
  applyPreset: (id: OrchestraPresetId, currentConfig: OrchestraConfig | null) => Promise<{ config: OrchestraConfig; warnings: string[] }>;
}

// Data older than this is refreshed in the background when a consumer mounts.
const STALE_MS = 5 * 60_000;

const INITIAL: OrchestraConfigSnapshot = Object.freeze({
  config: null,
  workers: null,
  configLoading: false,
  workersLoading: false,
  configError: null,
  workersError: null,
});

let state: OrchestraConfigSnapshot = INITIAL;
const listeners = new Set<() => void>();
let configGen = 0;
let workersGen = 0;
let configLoadedAt = 0;
let workersLoadedAt = 0;
let configPromise: Promise<void> | null = null;
let workersPromise: Promise<void> | null = null;

function setState(patch: Partial<OrchestraConfigSnapshot>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function loadConfig(): Promise<void> {
  if (configPromise) return configPromise;
  const gen = ++configGen;
  setState({ configLoading: true });
  configPromise = (async () => {
    try {
      const config = await fetchOrchestraConfig();
      if (gen !== configGen) return;
      configLoadedAt = Date.now();
      setState({ config, configLoading: false, configError: null });
    } catch (err) {
      if (gen !== configGen) return;
      setState({ configLoading: false, configError: errorMessage(err, "Orchester-Konfiguration konnte nicht geladen werden.") });
    } finally {
      if (gen === configGen) configPromise = null;
    }
  })();
  return configPromise;
}

function loadWorkers(): Promise<void> {
  if (workersPromise) return workersPromise;
  const gen = ++workersGen;
  setState({ workersLoading: true });
  workersPromise = (async () => {
    try {
      const workers = await fetchOrchestraWorkers(await gatherClientProviders());
      if (gen !== workersGen) return;
      workersLoadedAt = Date.now();
      setState({ workers, workersLoading: false, workersError: null });
    } catch (err) {
      if (gen !== workersGen) return;
      setState({ workersLoading: false, workersError: errorMessage(err, "Modelle konnten nicht geprüft werden.") });
    } finally {
      if (gen === workersGen) workersPromise = null;
    }
  })();
  return workersPromise;
}

function ensureFresh() {
  const now = Date.now();
  // A failed load is retried when the next consumer mounts (not in a loop).
  if (!configPromise && (!state.config || now - configLoadedAt > STALE_MS)) void loadConfig();
  if (!workersPromise && (!state.workers || now - workersLoadedAt > STALE_MS)) void loadWorkers();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  ensureFresh();
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => state;
const getServerSnapshot = () => INITIAL;

/** Re-fetches both (also after an error). */
export function reloadOrchestra(): Promise<void> {
  configPromise = null;
  workersPromise = null;
  return Promise.all([loadConfig(), loadWorkers()]).then(() => undefined);
}

export function reloadOrchestraWorkers(): Promise<void> {
  workersPromise = null;
  return loadWorkers();
}

export async function saveOrchestraConfig(config: OrchestraConfig): Promise<OrchestraConfig> {
  const saved = await putOrchestraConfig(config);
  configGen++; // a load still in flight must not overwrite what was just saved
  configPromise = null;
  configLoadedAt = Date.now();
  setState({ config: saved, configLoading: false, configError: null });
  return saved;
}

export async function computeOrchestraPreset(
  id: OrchestraPresetId,
  currentConfig: OrchestraConfig | null
): Promise<{ config: OrchestraConfig; warnings: string[] }> {
  return postOrchestraPreset(id, await gatherClientProviders(), currentConfig);
}

/**
 * The saved orchestra configuration and the available models, shared across
 * the app. Loads on first use; `save` updates the shared cache.
 */
export function useOrchestraConfig(): UseOrchestraConfigResult {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return useMemo(
    () => ({
      config: snap.config,
      workers: snap.workers,
      loading: (snap.config === null && !snap.configError) || (snap.workers === null && !snap.workersError),
      error: snap.config === null ? snap.configError : null,
      workersLoading: snap.workersLoading,
      workersError: snap.workersError,
      reload: reloadOrchestra,
      reloadWorkers: reloadOrchestraWorkers,
      save: saveOrchestraConfig,
      applyPreset: computeOrchestraPreset,
    }),
    [snap]
  );
}
