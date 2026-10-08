"use client";

import { useState, useEffect, useCallback } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { getApiKey, getBaseUrl } from "@/lib/ai/client-keys";
import { getProvider } from "@/lib/ai/catalog";
import { CircleCheck, CircleX, FlaskConical, Play, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button, IconButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SimpleSelect } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { confirm } from "@/components/ui/confirm";

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

const MATCH_OPTIONS = (Object.keys(MATCH_LABELS) as MatchType[]).map((k) => ({ value: k, label: MATCH_LABELS[k] }));

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

const EMPTY_DRAFT = { name: "", input: "", matchType: "contains" as MatchType, expected: "" };

export function TestCasePanel({
  promptId,
  xmlContent,
  versionLabel,
  onCountChange,
}: {
  promptId: string;
  xmlContent: string;
  /** e.g. "v3": which version the cases run against. */
  versionLabel?: string;
  onCountChange?: (n: number) => void;
}) {
  const { activeProvider, activeModel } = useSettingsStore();
  const [cases, setCases] = useState<TestCase[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [results, setResults] = useState<Record<string, CaseResult>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [expectedError, setExpectedError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/prompts/${promptId}/test-cases`)
      .then((r) => r.json())
      .then((d) => setCases(d.testCases || []))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [promptId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { onCountChange?.(cases.length); }, [cases.length, onCountChange]);

  async function addCase() {
    if (!draft.expected.trim() && draft.matchType !== "equals") {
      setExpectedError("Erwarteten Wert angeben.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/prompts/${promptId}/test-cases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (res.ok) {
        setDraft(EMPTY_DRAFT);
        setAdding(false);
        load();
        toast.success("Testfall hinzugefügt.");
      } else {
        toast.error("Testfall konnte nicht gespeichert werden.");
      }
    } catch {
      toast.error("Testfall konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteCase(tc: TestCase) {
    const ok = await confirm({
      title: "Testfall löschen?",
      description: `„${tc.name || tc.input || "Testfall"}“ wird entfernt.`,
      confirmLabel: "Löschen",
      tone: "danger",
    });
    if (!ok) return;
    await fetch(`/api/prompts/${promptId}/test-cases/${tc.id}`, { method: "DELETE" }).catch(() => {});
    setResults((prev) => { const n = { ...prev }; delete n[tc.id]; return n; });
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
    setResults({});
    try {
      // Sequential to avoid hammering a local Ollama with many parallel loads.
      for (const tc of cases) {
        setRunning(tc.id);
        const r = await runOne(tc);
        setResults((prev) => ({ ...prev, [tc.id]: r }));
      }
    } finally {
      setRunning(null);
    }
  }

  const passCount = Object.values(results).filter((r) => r.pass).length;
  const ranCount = Object.keys(results).length;
  const providerName = getProvider(activeProvider)?.label ?? activeProvider;
  const busy = running !== null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <p className="text-ui text-muted-foreground">
            Eingaben mit erwarteter Ausgabe – für Regressionstests nach jeder Änderung.
          </p>
          <p className="text-xs text-subtle-foreground">
            Läuft gegen {providerName}
            {activeModel ? ` · ${activeModel}` : ""}
            {versionLabel ? ` · testet ${versionLabel}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ranCount > 0 && !busy ? (
            <Badge variant={passCount === ranCount ? "success" : "warning"} size="md" className="tabular-nums">
              {passCount}/{ranCount} bestanden
            </Badge>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
            <Plus aria-hidden /> Testfall
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={runAll}
            loading={busy}
            disabledReason={cases.length === 0 ? "Erst einen Testfall anlegen" : undefined}
          >
            {busy ? null : <Play aria-hidden />} Alle ausführen
          </Button>
        </div>
      </div>

      {adding ? (
        <form
          className="space-y-3 rounded-lg border border-border bg-surface-2 p-3 md:p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void addCase();
          }}
        >
          <Field>
            <FieldLabel optional="optional">Name</FieldLabel>
            <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </Field>
          <Field>
            <FieldLabel optional="optional">Test-Eingabe</FieldLabel>
            <Textarea
              autosize={{ min: 2, max: 8 }}
              placeholder="Wird an den Prompt angehängt"
              value={draft.input}
              onChange={(e) => setDraft({ ...draft, input: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
            <Field>
              <FieldLabel>Prüfung</FieldLabel>
              <SimpleSelect
                options={MATCH_OPTIONS}
                value={draft.matchType}
                onValueChange={(v) => {
                  setDraft({ ...draft, matchType: v as MatchType });
                  setExpectedError(null);
                }}
              />
            </Field>
            <Field required={draft.matchType !== "equals"} invalid={!!expectedError}>
              <FieldLabel>Erwarteter Wert / Muster</FieldLabel>
              <Input
                value={draft.expected}
                onChange={(e) => {
                  setDraft({ ...draft, expected: e.target.value });
                  setExpectedError(null);
                }}
              />
              <FieldError>{expectedError}</FieldError>
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
              Abbrechen
            </Button>
            <Button type="submit" variant="primary" loading={saving}>
              Speichern
            </Button>
          </div>
        </form>
      ) : null}

      {loaded && cases.length === 0 && !adding ? (
        <EmptyState
          headingLevel={3}
          icon={<FlaskConical />}
          title="Noch keine Testfälle"
          description="Lege Eingaben mit erwarteter Ausgabe an, um Änderungen am Prompt abzusichern."
          action={
            <Button variant="outline" onClick={() => setAdding(true)}>
              <Plus aria-hidden /> Ersten Testfall anlegen
            </Button>
          }
        />
      ) : null}

      <ul className="space-y-2">
        {cases.map((tc) => {
          const r = results[tc.id];
          return (
            <li key={tc.id} className="space-y-2 rounded-lg border border-border bg-card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  {running === tc.id ? (
                    <Spinner aria-label="Läuft" />
                  ) : r ? (
                    r.pass ? (
                      <CircleCheck aria-label="bestanden" role="img" className="size-4 shrink-0 text-success" />
                    ) : (
                      <CircleX aria-label="fehlgeschlagen" role="img" className="size-4 shrink-0 text-danger" />
                    )
                  ) : null}
                  <span className="truncate text-ui font-medium">{tc.name || tc.input || "(ohne Eingabe)"}</span>
                </div>
                <IconButton
                  aria-label={`Testfall „${tc.name || tc.input || "ohne Eingabe"}“ löschen`}
                  variant="danger-ghost"
                  size="icon-sm"
                  className="-my-1.5 -mr-1.5 size-10 md:my-0 md:mr-0 md:size-7"
                  onClick={() => void deleteCase(tc)}
                  disabledReason={busy ? "Erst den Testlauf abwarten" : undefined}
                >
                  <Trash2 />
                </IconButton>
              </div>
              <p className="text-xs text-muted-foreground">
                {MATCH_LABELS[tc.matchType]}:{" "}
                <code className="rounded-sm bg-surface-2 px-1 font-mono text-foreground">{tc.expected || "—"}</code>
              </p>
              {r?.error ? <p className="text-xs text-danger">Fehler: {r.error}</p> : null}
              {r && !r.error ? (
                <pre
                  tabIndex={0}
                  aria-label="Ausgabe"
                  className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-surface-2 p-2 font-mono text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {r.output.slice(0, 1000)}
                  {r.output.length > 1000 ? "…" : ""}
                </pre>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
