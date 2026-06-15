"use client";

import { useState, useEffect, useRef } from "react";
import { useBuilderStore } from "@/stores/builder-store";
import { useSettingsStore } from "@/stores/settings-store";
import { getApiKey, getBaseUrl, fetchModelsForProvider } from "@/lib/ai/client-keys";
import { estimateCost, formatCost } from "@/lib/ai/pricing";
import { PROVIDERS, getProvider } from "@/lib/ai/catalog";
import type { ProviderName, ModelInfo } from "@/lib/ai/types";
import { Play, Loader2, RotateCcw, Columns } from "lucide-react";
import { toast } from "sonner";

interface TestRun {
  provider: ProviderName;
  model: string;
  output: string;
  latencyMs: number;
  timestamp: Date;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  isLocal: boolean;
}

const PROVIDER_OPTIONS: { id: ProviderName; label: string }[] = PROVIDERS.map((p) => ({
  id: p.id,
  label: p.label,
}));

export function PlaygroundView() {
  const { xmlContent, setXmlContent, currentPromptId } = useBuilderStore();
  const { activeProvider, activeModel } = useSettingsStore();
  const [testInput, setTestInput] = useState("");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<TestRun[]>([]);
  const [compareMode, setCompareMode] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<ProviderName>(activeProvider);
  const [selectedModel, setSelectedModel] = useState(activeModel);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const modelAbortRef = useRef<AbortController | null>(null);

  // Fetch the available models whenever the chosen provider changes, so the
  // model dropdown always reflects reality — including dynamically discovered
  // local Ollama models.
  useEffect(() => {
    modelAbortRef.current?.abort();
    const controller = new AbortController();
    modelAbortRef.current = controller;

    fetchModelsForProvider(selectedProvider, controller.signal)
      .then((m) => {
        setModels(m);
        setSelectedModel((prev) =>
          m.some((model) => model.id === prev) ? prev : m[0]?.id || ""
        );
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
      });

    return () => controller.abort();
  }, [selectedProvider]);

  async function runTest(provider: ProviderName, model: string) {
    const apiKey = await getApiKey(provider);
    const baseUrl = getBaseUrl(provider);
    const prompt = xmlContent + (testInput ? `\n\nUser Input: ${testInput}` : "");
    const start = performance.now();

    const res = await fetch("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: prompt }],
        provider,
        model,
        apiKey,
        baseUrl,
      }),
    });

    if (!res.ok) {
      let msg = `${provider} request failed`;
      try {
        const e = await res.json();
        if (e?.error) msg = `${provider}: ${e.error}`;
      } catch { /* ignore */ }
      throw new Error(msg);
    }
    const data = await res.json();
    const latencyMs = Math.round(performance.now() - start);
    const output = data.content || "";
    const cost = estimateCost(provider, model, prompt, output);

    return {
      provider, model, output, latencyMs, timestamp: new Date(),
      inputTokens: cost.inputTokens, outputTokens: cost.outputTokens,
      costUsd: cost.costUsd, isLocal: cost.isLocal,
    };
  }

  // Pick one model per provider that the user can actually run, for compare mode.
  async function buildComparisonTargets(): Promise<{ provider: ProviderName; model: string }[]> {
    const res = await fetch(`/api/ai/models`);
    const data = await res.json();
    const allModels: ModelInfo[] = data.models || [];

    const targets: { provider: ProviderName; model: string }[] = [];
    for (const { id: provider } of PROVIDER_OPTIONS) {
      const first = allModels.find((m) => m.provider === provider);
      if (!first) continue;
      // Always include local providers; skip cloud providers without a key.
      const isLocal = getProvider(provider)?.local;
      if (!isLocal && !(await getApiKey(provider))) continue;
      targets.push({ provider, model: first.id });
    }
    return targets;
  }

  async function handleRun() {
    if (!xmlContent.trim()) {
      toast.error("No prompt content. Build a prompt first or paste XML above.");
      return;
    }

    setRunning(true);
    try {
      let newResults: TestRun[];

      if (compareMode) {
        const targets = await buildComparisonTargets();
        if (targets.length === 0) {
          toast.error("No runnable models. Add an API key or start Ollama.");
          return;
        }
        const settled = await Promise.allSettled(
          targets.map((t) => runTest(t.provider, t.model))
        );
        newResults = settled
          .filter((s): s is PromiseFulfilledResult<TestRun> => s.status === "fulfilled")
          .map((s) => s.value);

        const failed = settled.filter((s) => s.status === "rejected").length;
        if (newResults.length === 0) {
          toast.error("All models failed. Check API keys / Ollama in Settings.");
          return;
        }
        if (failed > 0) {
          toast.warning(`${failed} model(s) failed; showing ${newResults.length} result(s).`);
        }
      } else {
        if (!selectedModel) {
          toast.error("No model selected. Check the provider in Settings.");
          return;
        }
        const result = await runTest(selectedProvider, selectedModel);
        newResults = [result];
      }

      setResults(newResults);

      // Save test results to DB using the fresh results (not stale closure)
      if (currentPromptId) {
        for (const r of newResults) {
          fetch("/api/test-results", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              promptId: currentPromptId,
              provider: r.provider,
              model: r.model,
              input: testInput,
              output: r.output,
              latencyMs: r.latencyMs,
              inputTokens: r.inputTokens,
              outputTokens: r.outputTokens,
              costUsd: r.costUsd,
            }),
          }).catch(() => {});
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test failed. Check your API key.");
      console.error(err);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Playground</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setCompareMode(!compareMode)}
            className={`flex items-center gap-1 px-3 py-1.5 text-sm rounded-md ${
              compareMode ? "bg-primary text-primary-foreground" : "border border-input hover:bg-accent"
            }`}
          >
            <Columns size={14} /> Compare Mode
          </button>
          <button
            onClick={() => { setResults([]); }}
            className="px-3 py-1.5 text-sm rounded-md border border-input hover:bg-accent flex items-center gap-1"
          >
            <RotateCcw size={14} /> Clear
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-3">
          <label className="text-sm font-medium">Prompt (XML)</label>
          <textarea
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono min-h-[200px] focus:outline-none focus:ring-2 focus:ring-ring"
            value={xmlContent}
            onChange={(e) => setXmlContent(e.target.value)}
            placeholder="Paste your XML prompt here or load from Builder/Library..."
          />
        </div>

        <div className="space-y-3">
          <label className="text-sm font-medium">Test Input (optional)</label>
          <textarea
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[100px] focus:outline-none focus:ring-2 focus:ring-ring"
            value={testInput}
            onChange={(e) => setTestInput(e.target.value)}
            placeholder="Additional input to append to the prompt..."
          />

          {compareMode ? (
            <p className="text-xs text-muted-foreground">
              Compare mode runs this prompt across one model per available provider
              (Claude, Gemini, and your local Ollama) — providers without a key are skipped.
            </p>
          ) : (
            <div className="flex gap-3">
              <select
                aria-label="Provider"
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={selectedProvider}
                onChange={(e) => setSelectedProvider(e.target.value as ProviderName)}
              >
                {PROVIDER_OPTIONS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
              <select
                aria-label="Model"
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
              >
                {models.length === 0 && (
                  <option value="" disabled>
                    {selectedProvider === "ollama"
                      ? "Keine Ollama-Modelle — läuft der Daemon?"
                      : "Keine Modelle verfügbar"}
                  </option>
                )}
                {models.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
          )}

          <button
            onClick={handleRun}
            disabled={running || !xmlContent.trim()}
            className="w-full px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {running ? (
              <><Loader2 size={16} className="animate-spin" /> Running...</>
            ) : (
              <><Play size={16} /> {compareMode ? "Run Comparison" : "Run Test"}</>
            )}
          </button>
        </div>
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className={`grid gap-4 ${results.length > 1 ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"}`}>
          {results.map((r, idx) => (
            <div key={idx} className="border border-border rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold capitalize">{r.provider} - {r.model}</span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {r.latencyMs}ms · ~{(r.inputTokens + r.outputTokens).toLocaleString()} tok · {formatCost(r.costUsd, r.isLocal)}
                </span>
              </div>
              <pre className="p-3 rounded bg-accent/30 text-sm whitespace-pre-wrap max-h-[400px] overflow-y-auto font-mono">
                {r.output}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
