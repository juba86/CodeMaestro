"use client";

// Browser-side provider setup: API keys and base URLs live (obfuscated, see
// @/lib/ai/crypto) in this device's localStorage; the Claude/Gemini login mode
// is a server setting (/api/settings). Shared by Settings → Provider and
// Settings → Standardmodell so a typed-but-unsaved key already drives the
// model list, exactly as before the split into sections.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useSettingsStore } from "@/stores/settings-store";
import { encryptApiKey, decryptApiKey } from "@/lib/ai/crypto";
import { fetchModelsForProvider } from "@/lib/ai/client-keys";
import type { ModelInfo } from "@/lib/ai/types";
import {
  PROVIDER_LIST,
  showKeyField,
  summarizeProviders,
  type AuthMode,
  type ProviderSetupSummary,
} from "./provider-status";

type LoginProvider = "claude" | "gemini";

const KEY_PREFIX = "pb-apikey-";
const BASE_PREFIX = "pb-baseurl-";

function readLocal(key: string): string {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

async function fetchAuthModes(): Promise<Record<LoginProvider, AuthMode>> {
  const d = (await fetch("/api/settings").then((r) => r.json())) as { settings?: Record<string, string> };
  return {
    claude: d.settings?.claudeAuthMode === "oauth" ? "oauth" : "key",
    gemini: d.settings?.geminiAuthMode === "oauth" ? "oauth" : "key",
  };
}

/**
 * One-off summary for the home status strip, computed exactly like the
 * settings page: stored keys, base URLs, login modes and the active provider.
 */
export async function loadProviderSummary(): Promise<ProviderSetupSummary> {
  const authModes = await fetchAuthModes().catch(() => ({ claude: "key", gemini: "key" }) as Record<LoginProvider, AuthMode>);
  const active = useSettingsStore.getState().activeProvider;
  return summarizeProviders(PROVIDER_LIST, (def) => ({
    hasKey: showKeyField(def) && readLocal(`${KEY_PREFIX}${def.id}`) !== "",
    baseUrl: def.configurableBaseUrl ? readLocal(`${BASE_PREFIX}${def.id}`) : undefined,
    authMode: def.id === "claude" || def.id === "gemini" ? authModes[def.id] : undefined,
    active: def.id === active,
  }));
}

export interface ProviderSetup {
  activeProvider: string;
  activeModel: string;
  setActiveModel: (model: string) => void;
  selectProvider: (provider: string) => void;
  /** Field values (typed, possibly unsaved). */
  apiKeys: Record<string, string>;
  baseUrls: Record<string, string>;
  /** Providers with a key stored in this browser. */
  storedKeys: Record<string, boolean>;
  authModes: Record<LoginProvider, AuthMode>;
  validating: string | null;
  validationResults: Record<string, boolean | null>;
  models: ModelInfo[];
  modelsLoading: boolean;
  summary: ProviderSetupSummary;
  handleKeyChange: (provider: string, value: string) => void;
  handleBaseChange: (provider: string, value: string) => void;
  changeAuthMode: (provider: LoginProvider, mode: AuthMode) => Promise<void>;
  saveKey: (provider: string) => Promise<void>;
  validateKey: (provider: string) => Promise<void>;
}

/**
 * `withModels`: load the active provider's model list (only Standardmodell
 * needs it; the other sections only need keys and the summary, so they don't
 * query the provider's API on every visit).
 */
export function useProviderSetup({ withModels = true }: { withModels?: boolean } = {}): ProviderSetup {
  const activeProvider = useSettingsStore((s) => s.activeProvider);
  const activeModel = useSettingsStore((s) => s.activeModel);
  const setActiveProvider = useSettingsStore((s) => s.setActiveProvider);
  const setActiveModel = useSettingsStore((s) => s.setActiveModel);

  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [baseUrls, setBaseUrls] = useState<Record<string, string>>({});
  const [storedKeys, setStoredKeys] = useState<Record<string, boolean>>({});
  const [validating, setValidating] = useState<string | null>(null);
  const [validationResults, setValidationResults] = useState<Record<string, boolean | null>>({});
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [authModes, setAuthModes] = useState<Record<LoginProvider, AuthMode>>({ claude: "key", gemini: "key" });
  const modelAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetchAuthModes().then(setAuthModes).catch(() => {});
  }, []);

  useEffect(() => {
    // Load stored keys + base URLs from localStorage.
    (async () => {
      for (const p of PROVIDER_LIST) {
        if (showKeyField(p)) {
          const enc = readLocal(`${KEY_PREFIX}${p.id}`);
          if (enc) {
            setStoredKeys((prev) => ({ ...prev, [p.id]: true }));
            try {
              const key = await decryptApiKey(enc);
              setApiKeys((prev) => ({ ...prev, [p.id]: key }));
            } catch { /* ignore */ }
          }
        }
        if (p.configurableBaseUrl) {
          const b = readLocal(`${BASE_PREFIX}${p.id}`);
          if (b) setBaseUrls((prev) => ({ ...prev, [p.id]: b }));
        }
      }
    })();
  }, []);

  const activeKey = apiKeys[activeProvider];
  const activeBase = baseUrls[activeProvider];
  useEffect(() => {
    modelAbortRef.current?.abort();
    if (!withModels) return;
    const controller = new AbortController();
    modelAbortRef.current = controller;
    setModelsLoading(true);

    fetchModelsForProvider(activeProvider, controller.signal, activeKey, activeBase)
      .then((m) => {
        setModels(m);
        setModelsLoading(false);
        // Only fall back to the first listed model when none is set: an id
        // missing from the list is usually typed on purpose (new/cloud models).
        // Switching providers clears the model, see selectProvider.
        if (m.length > 0 && !useSettingsStore.getState().activeModel) {
          setActiveModel(m[0].id);
        }
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setModelsLoading(false);
      });

    return () => controller.abort();
  }, [withModels, activeProvider, activeKey, activeBase, setActiveModel]);

  const selectProvider = useCallback(
    (provider: string) => {
      if (provider === useSettingsStore.getState().activeProvider) return;
      setActiveProvider(provider);
      // The previous provider's model id is meaningless here; the model-list
      // effect picks this provider's first model.
      setActiveModel("");
    },
    [setActiveProvider, setActiveModel],
  );

  const handleKeyChange = useCallback((provider: string, value: string) => {
    setApiKeys((prev) => ({ ...prev, [provider]: value }));
    setValidationResults((prev) => ({ ...prev, [provider]: null }));
  }, []);

  const handleBaseChange = useCallback((provider: string, value: string) => {
    setBaseUrls((prev) => ({ ...prev, [provider]: value }));
    setValidationResults((prev) => ({ ...prev, [provider]: null }));
    try {
      if (value.trim()) localStorage.setItem(`${BASE_PREFIX}${provider}`, value.trim());
      else localStorage.removeItem(`${BASE_PREFIX}${provider}`);
    } catch { /* ignore */ }
  }, []);

  const changeAuthMode = useCallback(
    async (provider: LoginProvider, mode: AuthMode) => {
      setAuthModes((prev) => ({ ...prev, [provider]: mode }));
      setValidationResults((prev) => ({ ...prev, [provider]: null }));
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: `${provider}AuthMode`, value: mode }),
      }).catch(() => {});
      // Without the model list on screen, the next load picks the new mode up.
      if (withModels && useSettingsStore.getState().activeProvider === provider) {
        const m = await fetchModelsForProvider(provider, undefined, apiKeys[provider]);
        setModels(m);
        // Keep a manually entered id even if it isn't listed; only fill a gap.
        if (m.length > 0 && !useSettingsStore.getState().activeModel) setActiveModel(m[0].id);
      }
      const name = provider === "claude" ? "Claude" : "Gemini";
      toast.success(mode === "oauth" ? `${name} nutzt jetzt den Login.` : `${name} nutzt jetzt den API-Key.`);
    },
    [apiKeys, setActiveModel, withModels],
  );

  const storeKey = useCallback(async (provider: string, key: string) => {
    const enc = await encryptApiKey(key);
    localStorage.setItem(`${KEY_PREFIX}${provider}`, enc);
    setStoredKeys((prev) => ({ ...prev, [provider]: true }));
  }, []);

  const saveKey = useCallback(
    async (provider: string) => {
      const key = apiKeys[provider] || "";
      try {
        if (!key.trim()) {
          localStorage.removeItem(`${KEY_PREFIX}${provider}`);
          setStoredKeys((prev) => ({ ...prev, [provider]: false }));
          toast.info("Key entfernt");
          return;
        }
        await storeKey(provider, key);
        toast.success("Gespeichert");
      } catch {
        toast.error("Speichern fehlgeschlagen: Browser-Speicher nicht verfügbar");
      }
    },
    [apiKeys, storeKey],
  );

  const validateKey = useCallback(
    async (provider: string) => {
      const oauth = (provider === "gemini" || provider === "claude") && authModes[provider] === "oauth";
      setValidating(provider);
      try {
        const res = await fetch("/api/ai/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider, apiKey: apiKeys[provider] || "", authMode: oauth ? "oauth" : "key", baseUrl: baseUrls[provider] }),
        });
        const { valid } = (await res.json()) as { valid?: boolean };
        setValidationResults((prev) => ({ ...prev, [provider]: Boolean(valid) }));
        if (valid && oauth) {
          toast.success("Verbindung funktioniert");
        } else if (valid) {
          // Auto-save a valid key so chat/generation (which read the stored key) work.
          if ((apiKeys[provider] || "").trim()) await storeKey(provider, apiKeys[provider]);
          toast.success("Verbindung funktioniert", {
            description: (apiKeys[provider] || "").trim() ? "Der Key wurde gespeichert." : undefined,
          });
        } else {
          toast.error(
            oauth
              ? `Verbindung fehlgeschlagen: Login nicht aktiv – auf dem Server einmalig \`${provider}\` einloggen`
              : "Verbindung fehlgeschlagen: Key oder Endpoint ungültig",
          );
        }
      } catch {
        setValidationResults((prev) => ({ ...prev, [provider]: false }));
        toast.error("Verbindung fehlgeschlagen: Server nicht erreichbar");
      } finally {
        setValidating(null);
      }
    },
    [apiKeys, authModes, baseUrls, storeKey],
  );

  const summary = useMemo(
    () =>
      summarizeProviders(PROVIDER_LIST, (def) => ({
        hasKey: Boolean(storedKeys[def.id]),
        baseUrl: baseUrls[def.id],
        authMode: def.id === "claude" || def.id === "gemini" ? authModes[def.id] : undefined,
        active: def.id === activeProvider,
      })),
    [storedKeys, baseUrls, authModes, activeProvider],
  );

  return {
    activeProvider,
    activeModel,
    setActiveModel,
    selectProvider,
    apiKeys,
    baseUrls,
    storedKeys,
    authModes,
    validating,
    validationResults,
    models,
    modelsLoading,
    summary,
    handleKeyChange,
    handleBaseChange,
    changeAuthMode,
    saveKey,
    validateKey,
  };
}
