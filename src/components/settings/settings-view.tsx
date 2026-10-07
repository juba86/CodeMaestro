"use client";

import { useState, useEffect, useRef } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { encryptApiKey, decryptApiKey } from "@/lib/ai/crypto";
import { fetchModelsForProvider } from "@/lib/ai/client-keys";
import { PROVIDERS, type ProviderDef } from "@/lib/ai/catalog";
import type { ModelInfo } from "@/lib/ai/types";
import { Check, X, Loader2, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { TelegramSettings } from "./telegram-settings";
import { GithubSettings } from "./github-settings";

// Display ordering: dedicated + cloud first, local/custom last.
const ORDER = ["claude", "gemini", "openai", "openrouter", "groq", "deepseek", "mistral", "xai", "together", "perplexity", "ollama-cloud", "ollama", "lmstudio", "custom"];
const providerList = [...PROVIDERS].sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));

function isOllama(def: ProviderDef) { return def.kind === "ollama"; }
function showKeyField(def: ProviderDef) { return !isOllama(def); }
function keyRequired(def: ProviderDef) { return !def.local && !def.keyOptional && !isOllama(def); }

export function SettingsView() {
  const { activeProvider, activeModel, setActiveProvider, setActiveModel, theme, setTheme } =
    useSettingsStore();
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [baseUrls, setBaseUrls] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [validating, setValidating] = useState<string | null>(null);
  const [validationResults, setValidationResults] = useState<Record<string, boolean | null>>({});
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [authModes, setAuthModes] = useState<{ claude: "key" | "oauth"; gemini: "key" | "oauth" }>({ claude: "key", gemini: "key" });
  const modelAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => setAuthModes({
        claude: d.settings?.claudeAuthMode === "oauth" ? "oauth" : "key",
        gemini: d.settings?.geminiAuthMode === "oauth" ? "oauth" : "key",
      }))
      .catch(() => {});
  }, []);

  const LOGIN_LABEL: Record<string, string> = { claude: "Login (Claude Code)", gemini: "Google-Login" };

  async function changeAuthMode(provider: "claude" | "gemini", mode: "key" | "oauth") {
    setAuthModes((prev) => ({ ...prev, [provider]: mode }));
    setValidationResults((prev) => ({ ...prev, [provider]: null }));
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: `${provider}AuthMode`, value: mode }),
    }).catch(() => {});
    if (activeProvider === provider) {
      const m = await fetchModelsForProvider(provider, undefined, apiKeys[provider]);
      setModels(m);
      // Keep a manually entered id even if it isn't listed; only fill a gap.
      if (m.length > 0 && !useSettingsStore.getState().activeModel) setActiveModel(m[0].id);
    }
    toast.success(mode === "oauth" ? `${provider === "claude" ? "Claude" : "Gemini"} nutzt jetzt Login.` : `${provider === "claude" ? "Claude" : "Gemini"} nutzt jetzt API-Key.`);
  }

  useEffect(() => {
    // Load stored keys + base URLs from localStorage.
    (async () => {
      for (const p of providerList) {
        if (showKeyField(p)) {
          const enc = localStorage.getItem(`pb-apikey-${p.id}`);
          if (enc) {
            try {
              const key = await decryptApiKey(enc);
              setApiKeys((prev) => ({ ...prev, [p.id]: key }));
            } catch { /* ignore */ }
          }
        }
        if (p.configurableBaseUrl) {
          const b = localStorage.getItem(`pb-baseurl-${p.id}`);
          if (b) setBaseUrls((prev) => ({ ...prev, [p.id]: b }));
        }
      }
    })();
  }, []);

  useEffect(() => {
    modelAbortRef.current?.abort();
    const controller = new AbortController();
    modelAbortRef.current = controller;

    fetchModelsForProvider(activeProvider, controller.signal, apiKeys[activeProvider], baseUrls[activeProvider])
      .then((m) => {
        setModels(m);
        // Only fall back to the first listed model when none is set: an id
        // missing from the list is usually typed on purpose (new/cloud models).
        // Switching providers clears the model, see selectProvider.
        if (m.length > 0 && !useSettingsStore.getState().activeModel) {
          setActiveModel(m[0].id);
        }
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProvider, apiKeys[activeProvider], baseUrls[activeProvider]]);

  function selectProvider(provider: string) {
    if (provider === activeProvider) return;
    setActiveProvider(provider);
    // The previous provider's model id is meaningless here; the model-list
    // effect picks this provider's first model.
    setActiveModel("");
  }

  function handleKeyChange(provider: string, value: string) {
    setApiKeys((prev) => ({ ...prev, [provider]: value }));
    setValidationResults((prev) => ({ ...prev, [provider]: null }));
  }

  function handleBaseChange(provider: string, value: string) {
    setBaseUrls((prev) => ({ ...prev, [provider]: value }));
    setValidationResults((prev) => ({ ...prev, [provider]: null }));
    try {
      if (value.trim()) localStorage.setItem(`pb-baseurl-${provider}`, value.trim());
      else localStorage.removeItem(`pb-baseurl-${provider}`);
    } catch { /* ignore */ }
  }

  async function saveKey(provider: string) {
    const key = apiKeys[provider] || "";
    if (!key.trim()) {
      localStorage.removeItem(`pb-apikey-${provider}`);
      toast.info("API key removed.");
      return;
    }
    const enc = await encryptApiKey(key);
    localStorage.setItem(`pb-apikey-${provider}`, enc);
    toast.success("API key saved.");
  }

  async function validateKey(provider: string) {
    const oauth = (provider === "gemini" || provider === "claude") && authModes[provider] === "oauth";
    setValidating(provider);
    try {
      const res = await fetch("/api/ai/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey: apiKeys[provider] || "", authMode: oauth ? "oauth" : "key", baseUrl: baseUrls[provider] }),
      });
      const { valid } = await res.json();
      setValidationResults((prev) => ({ ...prev, [provider]: valid }));
      if (valid && oauth) {
        toast.success("Login funktioniert.");
      } else if (valid) {
        // Auto-save a valid key so chat/generation (which read the stored key) work.
        if ((apiKeys[provider] || "").trim()) {
          const enc = await encryptApiKey(apiKeys[provider]);
          localStorage.setItem(`pb-apikey-${provider}`, enc);
        }
        toast.success("Verbindung gültig und gespeichert!");
      } else {
        toast.error(oauth
          ? `Login nicht aktiv. Auf dem Server \`${provider}\` einloggen.`
          : "Ungültig — Key/Endpoint prüfen.");
      }
    } catch {
      setValidationResults((prev) => ({ ...prev, [provider]: false }));
      toast.error("Validation failed.");
    } finally {
      setValidating(null);
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold">Settings</h1>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Aktiver Provider</h2>
        <div className="flex flex-wrap gap-2">
          {providerList.map((p) => (
            <button
              key={p.id}
              onClick={() => selectProvider(p.id)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activeProvider === p.id
                  ? "bg-primary text-primary-foreground"
                  : "border border-input hover:bg-accent"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-5">
        <h2 className="text-lg font-semibold">Provider & Keys</h2>
        {providerList.map((p) => {
          const supportsLogin = p.supportsOAuth && (p.id === "claude" || p.id === "gemini");
          const oauth = supportsLogin && authModes[p.id as "claude" | "gemini"] === "oauth";
          const required = keyRequired(p);
          return (
          <div key={p.id} className="space-y-2 border border-border rounded-lg p-3">
            <label className="text-sm font-medium flex items-center gap-2">
              {p.label}
              {p.local && <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-accent text-muted-foreground">lokal</span>}
              {!required && !p.local && p.keyOptional && <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent text-muted-foreground">Key optional</span>}
              {validationResults[p.id] === true && <Check size={14} className="text-green-500" />}
              {validationResults[p.id] === false && <X size={14} className="text-red-500" />}
            </label>

            {supportsLogin && (
              <div className="flex rounded-md border border-input overflow-hidden text-xs w-fit">
                {(["key", "oauth"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => changeAuthMode(p.id as "claude" | "gemini", m)}
                    className={`px-3 py-1 ${authModes[p.id as "claude" | "gemini"] === m ? "bg-primary text-primary-foreground font-medium" : "hover:bg-accent"}`}
                  >
                    {m === "key" ? "API-Key" : LOGIN_LABEL[p.id]}
                  </button>
                ))}
              </div>
            )}

            {p.configurableBaseUrl && (
              <input
                type="text"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Base-URL (z.B. http://localhost:8000/v1)"
                value={baseUrls[p.id] || ""}
                onChange={(e) => handleBaseChange(p.id, e.target.value)}
              />
            )}

            {oauth ? (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">
                  {p.id === "claude" ? (
                    <>Nutzt den Login der lokalen <code className="px-1 bg-accent rounded">claude</code>-CLI (Claude Code, kein API-Key). Auf dem Server einmalig <code className="px-1 bg-accent rounded">claude</code> einloggen.</>
                  ) : (
                    <>Nutzt den Google-Login der lokalen <code className="px-1 bg-accent rounded">gemini</code>-CLI (kein API-Key). Einmalig auf dem Server <code className="px-1 bg-accent rounded">gemini</code> ausführen und „Login with Google“ wählen.</>
                  )}
                </p>
                <button
                  onClick={() => validateKey(p.id)}
                  disabled={validating === p.id}
                  className="px-3 py-2 text-sm rounded-md border border-input hover:bg-accent disabled:opacity-50 flex items-center gap-1 w-fit"
                >
                  {validating === p.id ? <Loader2 size={14} className="animate-spin" /> : "Verbindung testen"}
                </button>
              </div>
            ) : isOllama(p) ? (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">
                  Kein API-Key nötig. Verbindet sich mit{" "}
                  <code className="px-1 bg-accent rounded">{process.env.NEXT_PUBLIC_OLLAMA_BASE_URL || "http://localhost:11434"}</code>.
                  Installierte Modelle erscheinen unten, sobald Ollama als Provider gewählt ist.
                </p>
                <button
                  onClick={() => validateKey("ollama")}
                  disabled={validating === "ollama"}
                  className="px-3 py-2 text-sm rounded-md border border-input hover:bg-accent disabled:opacity-50 flex items-center gap-1 w-fit"
                >
                  {validating === "ollama" ? <Loader2 size={14} className="animate-spin" /> : "Verbindung testen"}
                </button>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type={showKeys[p.id] ? "text" : "password"}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm pr-10 focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder={required ? `${p.label} API-Key` : `${p.label} API-Key (optional)`}
                      value={apiKeys[p.id] || ""}
                      onChange={(e) => handleKeyChange(p.id, e.target.value)}
                    />
                    <button
                      onClick={() => setShowKeys((prev) => ({ ...prev, [p.id]: !prev[p.id] }))}
                      aria-label={showKeys[p.id] ? `Hide ${p.label} API key` : `Show ${p.label} API key`}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                    >
                      {showKeys[p.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <button
                    onClick={() => saveKey(p.id)}
                    className="px-3 py-2 text-sm rounded-md border border-input hover:bg-accent"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => validateKey(p.id)}
                    disabled={validating === p.id || (required && !apiKeys[p.id])}
                    className="px-3 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1"
                  >
                    {validating === p.id ? <Loader2 size={14} className="animate-spin" /> : "Validate"}
                  </button>
                </div>
                {p.docs && (
                  <p className="text-xs text-muted-foreground">
                    {p.envKeys?.length ? <>Or set <code className="px-1 bg-accent rounded">{p.envKeys[0]}</code> in .env · </> : null}
                    <a href={p.docs.startsWith("http") ? p.docs : undefined} target="_blank" rel="noreferrer" className={p.docs.startsWith("http") ? "underline hover:text-foreground" : ""}>
                      {p.docs.startsWith("http") ? "Key holen" : p.docs}
                    </a>
                  </p>
                )}
              </>
            )}
          </div>
          );
        })}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Default Model</h2>
        <p className="text-xs text-muted-foreground">
          Aktiver Provider: <span className="font-medium">{activeProvider}</span>
        </p>
        <select
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={activeModel}
          onChange={(e) => setActiveModel(e.target.value)}
        >
          {models.length === 0 && (
            <option value="" disabled>
              {activeProvider === "ollama"
                ? "Keine Ollama-Modelle gefunden — läuft der Daemon?"
                : "Keine Modelle verfügbar"}
            </option>
          )}
          {/* Ensure a manually-entered model id (not in the discovered list) is still selectable. */}
          {activeModel && !models.some((m) => m.id === activeModel) && (
            <option value={activeModel}>{activeModel} (eigene)</option>
          )}
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <div className="space-y-1">
          <input
            type="text"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="… oder Modell-ID direkt eingeben (z.B. gpt-oss:120b-cloud)"
            value={activeModel}
            onChange={(e) => setActiveModel(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Praktisch für Ollama-Cloud-Modelle (Endung <code className="px-1 bg-accent rounded">-cloud</code>) oder neue Modelle, die noch nicht in der Liste erscheinen. Bei gesetztem API-Key wird die Live-Liste von <code className="px-1 bg-accent rounded">ollama.com</code> automatisch geladen.
          </p>
        </div>
      </section>

      <div className="border-t border-border pt-6">
        <GithubSettings />
      </div>

      <div className="border-t border-border pt-6">
        <TelegramSettings />
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Theme</h2>
        <div className="flex gap-2">
          {(["light", "dark", "system"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTheme(t)}
              className={`px-4 py-2 rounded-md text-sm capitalize ${
                theme === t
                  ? "bg-primary text-primary-foreground"
                  : "border border-input hover:bg-accent"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
