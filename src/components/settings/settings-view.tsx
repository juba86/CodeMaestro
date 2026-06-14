"use client";

import { useState, useEffect, useRef } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { encryptApiKey, decryptApiKey } from "@/lib/ai/crypto";
import { fetchModelsForProvider } from "@/lib/ai/client-keys";
import type { ProviderName, ModelInfo } from "@/lib/ai/types";
import { Check, X, Loader2, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

const providers: { id: ProviderName; label: string; envHint: string; local?: boolean }[] = [
  { id: "claude", label: "Claude (Anthropic)", envHint: "ANTHROPIC_API_KEY" },
  { id: "gemini", label: "Gemini (Google)", envHint: "GOOGLE_API_KEY" },
  { id: "ollama", label: "Ollama (lokal)", envHint: "OLLAMA_BASE_URL", local: true },
];

const keyProviders = providers.filter((p) => !p.local);

export function SettingsView() {
  const { activeProvider, activeModel, setActiveProvider, setActiveModel, theme, setTheme } =
    useSettingsStore();
  const [apiKeys, setApiKeys] = useState<Record<ProviderName, string>>({
    claude: "",
    gemini: "",
    ollama: "",
  });
  const [showKeys, setShowKeys] = useState<Record<ProviderName, boolean>>({
    claude: false,
    gemini: false,
    ollama: false,
  });
  const [validating, setValidating] = useState<ProviderName | null>(null);
  const [validationResults, setValidationResults] = useState<Record<ProviderName, boolean | null>>({
    claude: null,
    gemini: null,
    ollama: null,
  });
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
      if (m.length > 0 && !m.some((x) => x.id === activeModel)) setActiveModel(m[0].id);
    }
    toast.success(mode === "oauth" ? `${provider === "claude" ? "Claude" : "Gemini"} nutzt jetzt Login.` : `${provider === "claude" ? "Claude" : "Gemini"} nutzt jetzt API-Key.`);
  }

  useEffect(() => {
    // Load encrypted keys from localStorage
    (async () => {
      for (const p of keyProviders) {
        const enc = localStorage.getItem(`pb-apikey-${p.id}`);
        if (enc) {
          try {
            const key = await decryptApiKey(enc);
            setApiKeys((prev) => ({ ...prev, [p.id]: key }));
          } catch { /* ignore */ }
        }
      }
    })();
  }, []);

  useEffect(() => {
    // Cancel previous model fetch
    modelAbortRef.current?.abort();
    const controller = new AbortController();
    modelAbortRef.current = controller;

    fetchModelsForProvider(activeProvider, controller.signal, apiKeys[activeProvider])
      .then((m) => {
        setModels(m);
        if (m.length > 0 && !m.some((model) => model.id === activeModel)) {
          setActiveModel(m[0].id);
        }
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
      });

    return () => controller.abort();
    // Refetch live models when the provider changes or its key becomes available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProvider, apiKeys[activeProvider]]);

  function handleKeyChange(provider: ProviderName, value: string) {
    setApiKeys((prev) => ({ ...prev, [provider]: value }));
    // Reset validation status when key changes
    setValidationResults((prev) => ({ ...prev, [provider]: null }));
  }

  async function saveKey(provider: ProviderName) {
    const key = apiKeys[provider];
    if (!key.trim()) {
      localStorage.removeItem(`pb-apikey-${provider}`);
      toast.info("API key removed.");
      return;
    }
    const enc = await encryptApiKey(key);
    localStorage.setItem(`pb-apikey-${provider}`, enc);
    toast.success("API key saved.");
  }

  async function validateKey(provider: ProviderName) {
    const oauth = (provider === "gemini" || provider === "claude") && authModes[provider] === "oauth";
    setValidating(provider);
    try {
      const res = await fetch("/api/ai/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey: apiKeys[provider], authMode: oauth ? "oauth" : "key" }),
      });
      const { valid } = await res.json();
      setValidationResults((prev) => ({ ...prev, [provider]: valid }));
      if (valid && oauth) {
        toast.success("Login funktioniert.");
      } else if (valid) {
        // Auto-save on successful validation so the key is actually usable for
        // generation/chat (which read the stored key) — no separate Save needed.
        const enc = await encryptApiKey(apiKeys[provider]);
        localStorage.setItem(`pb-apikey-${provider}`, enc);
        toast.success("API key is valid and saved!");
      } else {
        toast.error(oauth
          ? `Login nicht aktiv. Auf dem Server \`${provider === "claude" ? "claude" : "gemini"}\` einloggen.`
          : "Invalid API key.");
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
        <h2 className="text-lg font-semibold">AI Provider</h2>
        <div className="flex gap-2">
          {providers.map((p) => (
            <button
              key={p.id}
              onClick={() => setActiveProvider(p.id)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
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

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">API Keys</h2>
        {keyProviders.map((p) => {
          const supportsLogin = p.id === "gemini" || p.id === "claude";
          const oauth = supportsLogin && authModes[p.id as "claude" | "gemini"] === "oauth";
          return (
          <div key={p.id} className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-2">
              {p.label}
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

            {oauth ? (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">
                  {p.id === "claude" ? (
                    <>Nutzt den Login der lokalen <code className="px-1 bg-accent rounded">claude</code>-CLI (Claude Code, kein API-Key). Auf dem Server einmalig <code className="px-1 bg-accent rounded">claude</code> einloggen.</>
                  ) : (
                    <>Nutzt den Google-Login der lokalen <code className="px-1 bg-accent rounded">gemini</code>-CLI (kein API-Key). Einmalig auf dem Server <code className="px-1 bg-accent rounded">gemini</code> ausführen und „Login with Google" wählen.</>
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
            ) : (
              <>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type={showKeys[p.id] ? "text" : "password"}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm pr-10 focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder={`Enter ${p.label} API key (or set ${p.envHint} in .env)`}
                      value={apiKeys[p.id]}
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
                    disabled={!apiKeys[p.id] || validating === p.id}
                    className="px-3 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1"
                  >
                    {validating === p.id ? <Loader2 size={14} className="animate-spin" /> : "Validate"}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Or set <code className="px-1 bg-accent rounded">{p.envHint}</code> in your .env file
                </p>
              </>
            )}
          </div>
          );
        })}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          Ollama (lokal)
          {validationResults.ollama === true && <Check size={14} className="text-green-500" />}
          {validationResults.ollama === false && <X size={14} className="text-red-500" />}
        </h2>
        <p className="text-xs text-muted-foreground">
          Kein API-Key nötig. Verbindet sich mit{" "}
          <code className="px-1 bg-accent rounded">
            {process.env.NEXT_PUBLIC_OLLAMA_BASE_URL || "http://localhost:11434"}
          </code>
          . Installierte Modelle erscheinen unten in der Modell-Auswahl, sobald du
          Ollama als Provider wählst. (Override per{" "}
          <code className="px-1 bg-accent rounded">OLLAMA_BASE_URL</code> in der .env.)
        </p>
        <button
          onClick={() => validateKey("ollama")}
          disabled={validating === "ollama"}
          className="px-3 py-2 text-sm rounded-md border border-input hover:bg-accent disabled:opacity-50 flex items-center gap-1"
        >
          {validating === "ollama" ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            "Verbindung testen"
          )}
        </button>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Default Model</h2>
        <p className="text-xs text-muted-foreground">
          Aktiver Provider:{" "}
          <span className="font-medium capitalize">{activeProvider}</span>
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
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </section>

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
