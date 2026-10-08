"use client";

import { useCallback, useEffect, useState } from "react";
import { loadProviderSummary } from "@/components/settings/use-provider-setup";
import type { HomePrompt, HomeSession } from "./home-logic";

export interface Resource<T> {
  data: T | null;
  /** German message of the last failure (data from an earlier load stays). */
  error: string | null;
  loading: boolean;
  retry: () => void;
}

/**
 * Loads one dashboard widget's data. `load` must be stable (a module-level
 * function); every widget fails and retries on its own (DESIGN.md §6.1).
 */
export function useResource<T>(load: () => Promise<T>): Resource<T> {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    load()
      .then((data) => {
        if (alive) setState({ data, error: null, loading: false });
      })
      .catch((err: unknown) => {
        if (alive) {
          setState((s) => ({ data: s.data, error: err instanceof Error ? err.message : "Laden fehlgeschlagen.", loading: false }));
        }
      });
    return () => {
      alive = false;
    };
  }, [load, attempt]);

  const retry = useCallback(() => {
    setState((s) => ({ ...s, error: null, loading: true }));
    setAttempt((n) => n + 1);
  }, []);

  return { ...state, retry };
}

async function getJson<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store" });
  } catch {
    throw new Error("Server nicht erreichbar.");
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !data) throw new Error(data?.error || `Fehler ${res.status}`);
  return data;
}

// Module-level loaders (stable identities for useResource).

export const loadSessions = () => getJson<{ sessions: HomeSession[] }>("/api/assistant/sessions").then((d) => d.sessions ?? []);

export const loadPrompts = () => getJson<{ prompts: HomePrompt[] }>("/api/prompts?limit=5").then((d) => d.prompts ?? []);

export interface HomeGithub {
  connected: boolean;
  tokenReadable: boolean;
  login: string | null;
}
export const loadGithub = () => getJson<{ status: HomeGithub }>("/api/github").then((d) => d.status);

export interface HomeTelegram {
  enabled: boolean;
  running: boolean;
  botUsername: string;
}
export const loadTelegram = () =>
  getJson<{ config?: { enabled?: boolean }; status?: { running?: boolean; botUsername?: string } }>("/api/assistant/telegram").then(
    (d): HomeTelegram => ({
      enabled: Boolean(d.config?.enabled),
      running: Boolean(d.status?.running),
      botUsername: d.status?.botUsername ?? "",
    }),
  );

export const loadKnowledge = () => getJson<{ docs: unknown[] }>("/api/knowledge").then((d) => ({ docs: (d.docs ?? []).length }));

export const loadProviders = loadProviderSummary;
