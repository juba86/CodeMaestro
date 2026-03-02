"use client";

import { useState } from "react";
import { useBuilderStore } from "@/stores/builder-store";
import { useSettingsStore } from "@/stores/settings-store";
import { decryptApiKey } from "@/lib/ai/crypto";
import type { ProviderName } from "@/lib/ai/types";
import { Play, Loader2, RotateCcw, Columns } from "lucide-react";
import { toast } from "sonner";

interface TestRun {
  provider: ProviderName;
  model: string;
  output: string;
  latencyMs: number;
  timestamp: Date;
}

export function PlaygroundView() {
  const { xmlContent, setXmlContent, currentPromptId } = useBuilderStore();
  const { activeProvider, activeModel } = useSettingsStore();
  const [testInput, setTestInput] = useState("");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<TestRun[]>([]);
  const [compareMode, setCompareMode] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<ProviderName>(activeProvider);
  const [selectedModel, setSelectedModel] = useState(activeModel);

  async function getApiKey(provider: ProviderName): Promise<string> {
    const enc = localStorage.getItem(`pb-apikey-${provider}`);
    if (enc) {
      try { return await decryptApiKey(enc); } catch { /* fallback */ }
    }
    return "";
  }

  async function runTest(provider: ProviderName, model: string) {
    const apiKey = await getApiKey(provider);
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
      }),
    });

    if (!res.ok) throw new Error("Test failed");
    const data = await res.json();
    const latencyMs = Math.round(performance.now() - start);

    return { provider, model, output: data.content, latencyMs, timestamp: new Date() };
  }

  async function handleRun() {
    if (!xmlContent.trim()) {
      toast.error("No prompt content. Build a prompt first or paste XML above.");
      return;
    }

    setRunning(true);
    try {
      if (compareMode) {
        const [claudeResult, geminiResult] = await Promise.allSettled([
          runTest("claude", "claude-sonnet-4-20250514"),
          runTest("gemini", "gemini-2.5-flash"),
        ]);

        const newResults: TestRun[] = [];
        if (claudeResult.status === "fulfilled") newResults.push(claudeResult.value);
        if (geminiResult.status === "fulfilled") newResults.push(geminiResult.value);

        if (newResults.length === 0) {
          toast.error("Both providers failed. Check API keys in Settings.");
        } else {
          setResults(newResults);
        }
      } else {
        const result = await runTest(selectedProvider, selectedModel);
        setResults([result]);
      }

      // Save test result to DB if we have a promptId
      if (currentPromptId && results.length > 0) {
        for (const r of results) {
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
            }),
          }).catch(() => {});
        }
      }
    } catch (err) {
      toast.error("Test failed. Check your API key.");
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

          {!compareMode && (
            <div className="flex gap-3">
              <select
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={selectedProvider}
                onChange={(e) => setSelectedProvider(e.target.value as ProviderName)}
              >
                <option value="claude">Claude</option>
                <option value="gemini">Gemini</option>
              </select>
              <select
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
              >
                {selectedProvider === "claude" ? (
                  <>
                    <option value="claude-opus-4-20250514">Claude Opus 4</option>
                    <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
                    <option value="claude-haiku-4-20250414">Claude Haiku 4</option>
                  </>
                ) : (
                  <>
                    <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                    <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                    <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                  </>
                )}
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
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold capitalize">{r.provider} - {r.model}</span>
                <span className="text-xs text-muted-foreground">{r.latencyMs}ms</span>
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
