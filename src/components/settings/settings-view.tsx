"use client";

import { useState, useEffect } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { encryptApiKey, decryptApiKey } from "@/lib/ai/crypto";
import type { ProviderName, ModelInfo } from "@/lib/ai/types";
import { Check, X, Loader2, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

const providers: { id: ProviderName; label: string; envHint: string }[] = [
  { id: "claude", label: "Claude (Anthropic)", envHint: "ANTHROPIC_API_KEY" },
  { id: "gemini", label: "Gemini (Google)", envHint: "GOOGLE_API_KEY" },
];

export function SettingsView() {
  const { activeProvider, activeModel, setActiveProvider, setActiveModel, theme, setTheme } =
    useSettingsStore();
  const [apiKeys, setApiKeys] = useState<Record<ProviderName, string>>({
    claude: "",
    gemini: "",
  });
  const [showKeys, setShowKeys] = useState<Record<ProviderName, boolean>>({
    claude: false,
    gemini: false,
  });
  const [validating, setValidating] = useState<ProviderName | null>(null);
  const [validationResults, setValidationResults] = useState<Record<ProviderName, boolean | null>>({
    claude: null,
    gemini: null,
  });
  const [models, setModels] = useState<ModelInfo[]>([]);

  useEffect(() => {
    // Load encrypted keys from localStorage
    (async () => {
      for (const p of providers) {
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
    fetch(`/api/ai/models?provider=${activeProvider}`)
      .then((r) => r.json())
      .then((d) => {
        const m = d.models || [];
        setModels(m);
        if (m.length > 0 && !m.some((model: ModelInfo) => model.id === activeModel)) {
          setActiveModel(m[0].id);
        }
      })
      .catch(() => {});
  }, [activeProvider]);

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
    setValidating(provider);
    try {
      const res = await fetch("/api/ai/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey: apiKeys[provider] }),
      });
      const { valid } = await res.json();
      setValidationResults((prev) => ({ ...prev, [provider]: valid }));
      toast[valid ? "success" : "error"](
        valid ? "API key is valid!" : "Invalid API key."
      );
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
        {providers.map((p) => (
          <div key={p.id} className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-2">
              {p.label}
              {validationResults[p.id] === true && <Check size={14} className="text-green-500" />}
              {validationResults[p.id] === false && <X size={14} className="text-red-500" />}
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showKeys[p.id] ? "text" : "password"}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm pr-10 focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder={`Enter ${p.label} API key (or set ${p.envHint} in .env)`}
                  value={apiKeys[p.id]}
                  onChange={(e) => setApiKeys((prev) => ({ ...prev, [p.id]: e.target.value }))}
                />
                <button
                  onClick={() => setShowKeys((prev) => ({ ...prev, [p.id]: !prev[p.id] }))}
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
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Default Model</h2>
        <select
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={activeModel}
          onChange={(e) => setActiveModel(e.target.value)}
        >
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
