"use client";

import { useState, useEffect, useCallback } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { getApiKey, getBaseUrl } from "@/lib/ai/client-keys";
import { Plus, Trash2, Play, Check, X, Loader2 } from "lucide-react";
import { toast } from "sonner";

type MatchType = "contains" | "icontains" | "regex" | "equals";

interface TestCase {
  id: string;
  name: string;
  input: string;
  matchType: MatchType;
  expected: string;
}

interface CaseResult {
  pass: boolean;
  output: string;
  error?: string;
}

const MATCH_LABELS: Record<MatchType, string> = {
  contains: "enthält",
  icontains: "enthält (ohne Groß/Klein)",
  regex: "Regex",
  equals: "exakt gleich",
};

// An empty `expected` is deliberate only for "equals" (the UI requires a value
// otherwise) and then means "the output must be empty"; for the substring and
// regex matchers it trivially matches, as "" / an empty pattern always do.
function evaluateMatch(output: string, matchType: MatchType, expected: string): boolean {
  switch (matchType) {
    case "contains": return output.includes(expected);
    case "icontains": return output.toLowerCase().includes(expected.toLowerCase());
    case "equals": return output.trim() === expected.trim();
    case "regex":
      try { return new RegExp(expected).test(output); } catch { return false; }
  }
}

export function TestCasePanel({ promptId, xmlContent }: { promptId: string; xmlContent: string }) {
  const { activeProvider, activeModel } = useSettingsStore();
  const [cases, setCases] = useState<TestCase[]>([]);
  const [results, setResults] = useState<Record<string, CaseResult>>({});
  const [running, setRunning] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", input: "", matchType: "contains" as MatchType, expected: "" });

  const load = useCallback(() => {
    fetch(`/api/prompts/${promptId}/test-cases`)
      .then((r) => r.json())
      .then((d) => setCases(d.testCases || []))
      .catch(() => {});
  }, [promptId]);

  useEffect(() => { load(); }, [load]);

  async function addCase() {
    if (!draft.expected.trim() && draft.matchType !== "equals") {
      toast.error("Erwarteten Wert angeben.");
      return;
    }
    const res = await fetch(`/api/prompts/${promptId}/test-cases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    if (res.ok) {
      setDraft({ name: "", input: "", matchType: "contains", expected: "" });
      setAdding(false);
      load();
      toast.success("Testfall hinzugefügt.");
    } else {
      toast.error("Konnte Testfall nicht speichern.");
    }
  }

  async function deleteCase(caseId: string) {
    await fetch(`/api/prompts/${promptId}/test-cases/${caseId}`, { method: "DELETE" });
    setResults((prev) => { const n = { ...prev }; delete n[caseId]; return n; });
    load();
  }

  async function runOne(tc: TestCase): Promise<CaseResult> {
    const apiKey = await getApiKey(activeProvider);
    const baseUrl = getBaseUrl(activeProvider);
    const prompt = xmlContent + (tc.input ? `\n\nUser Input: ${tc.input}` : "");
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: prompt }],
          provider: activeProvider,
          model: activeModel,
          apiKey,
          baseUrl,
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        return { pass: false, output: "", error: e.error || `HTTP ${res.status}` };
      }
      const data = await res.json();
      const output = data.content || "";
      return { pass: evaluateMatch(output, tc.matchType, tc.expected), output };
    } catch (err) {
      return { pass: false, output: "", error: err instanceof Error ? err.message : "Fehler" };
    }
  }

  async function runAll() {
    if (cases.length === 0) return;
    if (!xmlContent.trim()) { toast.error("Kein Prompt-Inhalt zum Testen."); return; }
    setRunning(true);
    setResults({});
    try {
      // Sequential to avoid hammering a local Ollama with many parallel loads.
      for (const tc of cases) {
        const r = await runOne(tc);
        setResults((prev) => ({ ...prev, [tc.id]: r }));
      }
    } finally {
      setRunning(false);
    }
  }

  const passCount = Object.values(results).filter((r) => r.pass).length;
  const ranCount = Object.keys(results).length;

  return (
    <div className="border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          Test Cases ({cases.length})
          {ranCount > 0 && (
            <span className={`ml-2 text-xs ${passCount === ranCount ? "text-green-500" : "text-amber-500"}`}>
              {passCount}/{ranCount} bestanden
            </span>
          )}
        </h3>
        <div className="flex gap-2">
          <button
            onClick={() => setAdding((v) => !v)}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-input hover:bg-accent"
          >
            <Plus size={12} /> Neu
          </button>
          <button
            onClick={runAll}
            disabled={running || cases.length === 0}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
            Alle ausführen
          </button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Läuft gegen aktiven Provider <span className="font-medium capitalize">{activeProvider}</span> ({activeModel || "—"}).
      </p>

      {adding && (
        <div className="space-y-2 rounded-md border border-input p-3">
          <input
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            placeholder="Name (optional)"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <textarea
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm min-h-[50px]"
            placeholder="Test-Input (wird an den Prompt angehängt)"
            value={draft.input}
            onChange={(e) => setDraft({ ...draft, input: e.target.value })}
          />
          <div className="flex gap-2">
            <select
              aria-label="Match-Typ"
              className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              value={draft.matchType}
              onChange={(e) => setDraft({ ...draft, matchType: e.target.value as MatchType })}
            >
              {Object.entries(MATCH_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <input
              className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              placeholder="Erwarteter Wert / Muster"
              value={draft.expected}
              onChange={(e) => setDraft({ ...draft, expected: e.target.value })}
            />
          </div>
          <div className="flex gap-2">
            <button onClick={addCase} className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90">
              Speichern
            </button>
            <button onClick={() => setAdding(false)} className="px-3 py-1.5 text-xs rounded-md border border-input hover:bg-accent">
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {cases.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground">
          Noch keine Testfälle. Definiere Eingaben + erwartete Ausgaben für Regressionstests.
        </p>
      )}

      <ul className="space-y-2">
        {cases.map((tc) => {
          const r = results[tc.id];
          return (
            <li key={tc.id} className="rounded-md border border-border p-2.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {r && (r.pass
                    ? <Check size={14} className="text-green-500 shrink-0" />
                    : <X size={14} className="text-red-500 shrink-0" />)}
                  <span className="text-sm font-medium truncate">{tc.name || tc.input || "(kein Input)"}</span>
                </div>
                <button onClick={() => deleteCase(tc.id)} aria-label="Testfall löschen" className="text-muted-foreground hover:text-destructive shrink-0">
                  <Trash2 size={13} />
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                {MATCH_LABELS[tc.matchType]}: <code className="px-1 bg-accent rounded">{tc.expected || "—"}</code>
              </p>
              {r?.error && <p className="text-xs text-red-500">Fehler: {r.error}</p>}
              {r && !r.error && (
                <pre className="text-xs bg-accent/30 rounded p-2 max-h-32 overflow-y-auto whitespace-pre-wrap">
                  {r.output.slice(0, 1000)}{r.output.length > 1000 ? "…" : ""}
                </pre>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
