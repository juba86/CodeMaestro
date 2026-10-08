"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Copy, FlaskConical, Library, Plus, RotateCcw, SlidersHorizontal, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useBuilderStore } from "@/stores/builder-store";
import { useSettingsStore } from "@/stores/settings-store";
import { getApiKey, getBaseUrl } from "@/lib/ai/client-keys";
import { estimateCost } from "@/lib/ai/pricing";
import { PROVIDERS, getProvider } from "@/lib/ai/catalog";
import { getModelProfile } from "@/lib/prompt-engine/model-profile";
import type { ProviderName, ModelInfo } from "@/lib/ai/types";
import { formatCost } from "@/lib/format";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { useIsMobile } from "@/hooks/use-media-query";
import { PageHeader } from "@/components/ui/page-header";
import { Button, IconButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, FieldError, FieldHint, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SegmentedControl, SegmentedItem } from "@/components/ui/segmented-control";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { Kbd } from "@/components/ui/kbd";
import { useCopy } from "@/components/ui/copy-text";
import { cn } from "@/components/ui/cn";
import { modKeyLabel, useIsApple } from "@/components/layout/use-client-info";
import { SavePromptDialog } from "@/components/builder/save-prompt-dialog";
import { syncedStructured } from "@/components/builder/xml-sync";
import { markXmlInSync } from "@/components/builder/draft-sync";
import { buildXml } from "@/lib/prompt-engine/xml-builder";
import { loadIntoBuilder, type SavedPrompt } from "@/components/library/load-into-builder";
import { ModelSelect } from "./model-select";
import { streamChat, type ChatParams } from "./chat-stream";

interface Target {
  key: string;
  provider: ProviderName;
  model: string;
}

interface RunResult {
  key: string;
  provider: ProviderName;
  model: string;
  status: "running" | "done" | "error" | "stopped";
  output: string;
  error?: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  isLocal?: boolean;
}

const MAX_COLUMNS = 3;
let keySeq = 0;
const newKey = () => `t${++keySeq}`;

const providerName = (p: ProviderName) => getProvider(p)?.label ?? p;
const seconds = (ms: number) => `${(ms / 1000).toLocaleString("de-DE", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} s`;

/**
 * Up to three models to compare: the configured default first, then one per
 * other provider that can run (local ones always, cloud ones with a key).
 */
async function defaultComparisonTargets(active: { provider: ProviderName; model: string }): Promise<Target[]> {
  const res = await fetch(`/api/ai/models`);
  const data = await res.json().catch(() => ({}));
  const allModels: ModelInfo[] = data.models || [];
  const targets: Target[] = active.model ? [{ key: newKey(), provider: active.provider, model: active.model }] : [];
  for (const { id: provider } of PROVIDERS) {
    if (targets.some((t) => t.provider === provider)) continue;
    if (targets.length >= MAX_COLUMNS) break;
    const first = allModels.find((m) => m.provider === provider);
    if (!first) continue;
    const isLocal = getProvider(provider)?.local;
    if (!isLocal && !(await getApiKey(provider))) continue;
    targets.push({ key: newKey(), provider, model: first.id });
  }
  return targets;
}

function ResultCard({ r, onStop }: { r: RunResult; onStop?: () => void }) {
  const { copied, copy } = useCopy();
  const cost = r.isLocal ? null : formatCost(r.costUsd);
  const tokens = r.inputTokens != null && r.outputTokens != null ? r.inputTokens + r.outputTokens : null;
  return (
    <section
      aria-label={`Ergebnis ${providerName(r.provider)} · ${r.model}`}
      className={cn(
        "flex min-w-0 flex-col rounded-lg border bg-card shadow-xs",
        r.status === "error" ? "border-danger-border" : r.status === "running" ? "border-primary-border" : "border-border",
      )}
    >
      <header className="flex items-start justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-ui font-medium">{providerName(r.provider)}</p>
          <p className="truncate font-mono text-xs text-muted-foreground">{r.model}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {r.status === "running" ? (
            <>
              <Badge variant="brand" icon={<Spinner className="size-3" />}>
                läuft
              </Badge>
              {onStop ? (
                <IconButton aria-label="Abbrechen" size="icon-sm" className="size-10 md:size-7" onClick={onStop}>
                  <Square />
                </IconButton>
              ) : null}
            </>
          ) : r.status === "error" ? (
            <Badge variant="danger">Fehler</Badge>
          ) : r.status === "stopped" ? (
            <Badge variant="neutral">abgebrochen</Badge>
          ) : (
            <IconButton
              aria-label={copied ? "Kopiert" : "Ausgabe kopieren"}
              size="icon-sm"
              className="size-10 md:size-7"
              onClick={() => void copy(r.output)}
            >
              {copied ? <Check className="text-success" /> : <Copy />}
            </IconButton>
          )}
        </div>
      </header>
      {r.status !== "running" && (r.latencyMs != null || tokens != null) ? (
        <dl className="flex flex-wrap gap-x-4 gap-y-1 border-b border-border px-3 py-2 text-xs">
          {r.latencyMs != null ? (
            <div className="flex gap-1">
              <dt className="text-subtle-foreground">Dauer</dt>
              <dd className="tabular-nums">{seconds(r.latencyMs)}</dd>
            </div>
          ) : null}
          {tokens != null && tokens > 0 ? (
            <div className="flex gap-1">
              <dt className="text-subtle-foreground">Tokens</dt>
              <dd className="tabular-nums">~{tokens.toLocaleString("de-DE")}</dd>
            </div>
          ) : null}
          {cost ? (
            <div className="flex gap-1">
              <dt className="text-subtle-foreground">Kosten</dt>
              <dd className="tabular-nums">{cost.startsWith("<") ? cost : `~${cost}`}</dd>
            </div>
          ) : null}
          {r.isLocal ? (
            <div className="flex gap-1">
              <dt className="sr-only">Kosten</dt>
              <dd className="text-subtle-foreground">lokal</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {r.error ? <p className="px-3 pt-2.5 text-xs text-danger">{r.error}</p> : null}
      <pre
        tabIndex={0}
        aria-label="Ausgabe"
        className="max-h-[28rem] min-h-24 flex-1 overflow-y-auto whitespace-pre-wrap break-words p-3 font-mono text-xs leading-5 text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        {r.output || (r.status === "running" ? <span className="text-subtle-foreground">Warte auf Antwort …</span> : null)}
      </pre>
    </section>
  );
}

export function PlaygroundView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { xmlContent, setXmlContent, currentPromptId } = useBuilderStore();
  const { activeProvider, activeModel } = useSettingsStore();
  const isMobile = useIsMobile();
  const isApple = useIsApple();

  const [mode, setMode] = useState<"single" | "compare">("single");
  const [view, setView] = useState<"prompt" | "result">("prompt");
  const [testInput, setTestInput] = useState("");
  const [single, setSingle] = useState<Target>(() => ({ key: "single", provider: activeProvider, model: activeModel }));
  const [columns, setColumns] = useState<Target[] | null>(null);
  const [results, setResults] = useState<RunResult[]>([]);
  const [running, setRunning] = useState(false);
  const [maxTokens, setMaxTokens] = useState("");
  const [temperature, setTemperature] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [resultTab, setResultTab] = useState<string>("");
  const controllers = useRef(new Map<string, AbortController>());
  const loadedParam = useRef<string | null>(null);

  // /playground?prompt=<id> (Bibliothek → „Im Playground testen"): load that
  // prompt into the shared draft, then drop the parameter.
  useEffect(() => {
    const id = searchParams.get("prompt");
    if (!id || loadedParam.current === id) return;
    loadedParam.current = id;
    (async () => {
      try {
        const res = await fetch(`/api/prompts/${encodeURIComponent(id)}`);
        if (!res.ok) throw new Error(String(res.status));
        const { prompt } = (await res.json()) as { prompt: SavedPrompt };
        if (await loadIntoBuilder(prompt)) toast.success(`Prompt geladen: ${prompt.title}`);
      } catch {
        toast.error("Prompt konnte nicht geladen werden.");
      } finally {
        router.replace("/playground", { scroll: false });
      }
    })();
  }, [searchParams, router]);

  // Comparison columns: filled once with up to three runnable models.
  useEffect(() => {
    if (mode !== "compare" || columns !== null) return;
    let cancelled = false;
    defaultComparisonTargets({ provider: activeProvider, model: activeModel })
      .then((t) => {
        if (!cancelled) setColumns(t.length > 0 ? t : [{ key: newKey(), provider: activeProvider, model: activeModel }]);
      })
      .catch(() => {
        if (!cancelled) setColumns([{ key: newKey(), provider: activeProvider, model: activeModel }]);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, columns, activeProvider, activeModel]);

  // Abort streams when leaving the page.
  useEffect(() => {
    const map = controllers.current;
    return () => {
      for (const c of map.values()) c.abort();
    };
  }, []);

  const targets: Target[] = useMemo(() => (mode === "single" ? [single] : (columns ?? [])), [mode, single, columns]);

  // The selected models that reject sampling parameters (Claude 4.7+/5.x).
  const rejectsTemperature = useMemo(
    () => targets.filter((t) => getModelProfile(t.provider, t.model).rejectsSampling),
    [targets],
  );

  const maxTokensValue = maxTokens.trim() ? Number(maxTokens) : undefined;
  const temperatureValue = temperature.trim() ? Number(temperature.replace(",", ".")) : undefined;
  const maxTokensError =
    maxTokensValue != null && !(Number.isInteger(maxTokensValue) && maxTokensValue >= 1 && maxTokensValue <= 128000)
      ? "Ganze Zahl von 1 bis 128.000"
      : null;
  const temperatureError =
    temperatureValue != null && !(Number.isFinite(temperatureValue) && temperatureValue >= 0 && temperatureValue <= 2)
      ? "Wert von 0 bis 2"
      : null;
  const paramsSet = maxTokensValue != null || temperatureValue != null;

  function updateSingle(next: { provider: ProviderName; model: string }) {
    // Back on the default provider, restore its configured (possibly typed) model.
    const model = !next.model && next.provider === activeProvider ? activeModel : next.model;
    setSingle({ key: "single", provider: next.provider, model });
  }

  function updateColumn(key: string, next: { provider: ProviderName; model: string }) {
    const model = !next.model && next.provider === activeProvider ? activeModel : next.model;
    setColumns((cols) => (cols ?? []).map((c) => (c.key === key ? { ...c, ...next, model } : c)));
  }

  const runBlockedReason = !xmlContent.trim()
    ? "Erst einen Prompt eingeben"
    : targets.length === 0
      ? mode === "compare" && columns === null
        ? "Modelle werden ermittelt …"
        : "Erst ein Modell wählen"
      : targets.some((t) => !t.model)
        ? "Erst ein Modell wählen"
        : maxTokensError || temperatureError
          ? "Parameter prüfen"
          : undefined;

  const patchResult = useCallback((key: string, patch: Partial<RunResult>) => {
    setResults((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }, []);

  async function runOne(t: Target, prompt: string): Promise<RunResult | null> {
    const controller = new AbortController();
    controllers.current.set(t.key, controller);
    const start = performance.now();
    const params: ChatParams = {
      maxTokens: maxTokensValue,
      // Models that reject sampling parameters get none (HTTP 400 otherwise).
      temperature: getModelProfile(t.provider, t.model).rejectsSampling ? undefined : temperatureValue,
    };
    try {
      const [apiKey, baseUrl] = [await getApiKey(t.provider), getBaseUrl(t.provider)];
      const { text, error } = await streamChat({
        provider: t.provider,
        model: t.model,
        prompt,
        apiKey,
        baseUrl,
        params,
        signal: controller.signal,
        onDelta: (output) => patchResult(t.key, { output }),
      });
      const latencyMs = Math.round(performance.now() - start);
      const cost = estimateCost(t.provider, t.model, prompt, text);
      const done: RunResult = {
        key: t.key,
        provider: t.provider,
        model: t.model,
        status: error && !text ? "error" : "done",
        output: text,
        error: error ? `Fehler der KI: ${error}` : undefined,
        latencyMs,
        inputTokens: cost.inputTokens,
        outputTokens: cost.outputTokens,
        costUsd: cost.costUsd,
        isLocal: cost.isLocal,
      };
      patchResult(t.key, done);
      return done.status === "done" ? done : null;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        patchResult(t.key, { status: "stopped", latencyMs: Math.round(performance.now() - start) });
      } else {
        patchResult(t.key, {
          status: "error",
          error: err instanceof Error ? err.message : "Anfrage fehlgeschlagen.",
        });
      }
      return null;
    } finally {
      controllers.current.delete(t.key);
    }
  }

  async function handleRun() {
    if (runBlockedReason || running) return;
    const prompt = xmlContent + (testInput ? `\n\nUser Input: ${testInput}` : "");
    const runTargets = targets.map((t) => ({ ...t, key: newKey() }));
    setResults(runTargets.map((t) => ({ key: t.key, provider: t.provider, model: t.model, status: "running", output: "" })));
    setResultTab(runTargets[0]?.key ?? "");
    setRunning(true);
    if (isMobile) setView("result");
    try {
      const settled = await Promise.all(runTargets.map((t) => runOne(t, prompt)));
      const ok = settled.filter((r): r is RunResult => r !== null);
      const failed = settled.length - ok.length;
      if (runTargets.length > 1 && failed > 0 && ok.length > 0) {
        toast.warning(`${failed} von ${runTargets.length} Modellen ohne Ergebnis.`);
      }

      // Save the test results against the loaded library prompt.
      if (currentPromptId) {
        for (const r of ok) {
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
    } finally {
      setRunning(false);
    }
  }

  // The XML edited here is the source: bring the builder's fields in line
  // before saving, so the library stores matching XML and structured data.
  function openSave() {
    const b = useBuilderStore.getState();
    if (buildXml(b.structured) !== b.xmlContent) {
      const next = syncedStructured(b.xmlContent, b.structured);
      if (next) {
        b.updateStructured(next);
        markXmlInSync(next);
      }
    }
    setSaveOpen(true);
  }

  function stopAll() {
    for (const c of controllers.current.values()) c.abort();
  }

  const runKbd = isApple === null ? undefined : modKeyLabel(isApple, "↵");
  useHotkeys({ "mod+enter": () => void handleRun() }, { allowInInputs: ["mod+enter"] });

  const editor = (
    <div className="space-y-4">
      <Field>
        <div className="flex items-center justify-between gap-2">
          <FieldLabel>Prompt (XML)</FieldLabel>
          {currentPromptId ? (
            <span className="text-xs text-subtle-foreground">Ergebnisse werden beim Bibliotheks-Prompt gespeichert</span>
          ) : null}
        </div>
        <Textarea
          autosize={{ min: 12, max: 32 }}
          className="font-mono md:text-xs md:leading-5"
          value={xmlContent}
          onChange={(e) => setXmlContent(e.target.value)}
          placeholder="XML-Prompt hier einfügen oder aus Builder bzw. Bibliothek übernehmen …"
          spellCheck={false}
        />
        <FieldHint>Derselbe Entwurf wie im Builder – Änderungen gelten dort auch.</FieldHint>
      </Field>
      <Field>
        <FieldLabel optional="optional">Test-Eingabe</FieldLabel>
        <Textarea
          autosize={{ min: 3, max: 12 }}
          value={testInput}
          onChange={(e) => setTestInput(e.target.value)}
          placeholder="Wird als „User Input“ an den Prompt angehängt …"
        />
      </Field>
    </div>
  );

  const paramsPopover = (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" aria-haspopup="dialog">
          <SlidersHorizontal aria-hidden /> Parameter
          {paramsSet ? <span aria-hidden className="size-1.5 rounded-full bg-primary-text" /> : null}
          {paramsSet ? <span className="sr-only">(gesetzt)</span> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" aria-labelledby="pg-params-title" className="w-80 space-y-3">
        <p id="pg-params-title" className="text-ui font-medium">
          Parameter
        </p>
        <Field invalid={!!maxTokensError}>
          <FieldLabel optional="optional">Max. Tokens</FieldLabel>
          <Input inputMode="numeric" value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} placeholder="Standard des Anbieters" />
          <FieldError>{maxTokensError}</FieldError>
        </Field>
        <Field invalid={!!temperatureError}>
          <FieldLabel optional="optional">Temperatur</FieldLabel>
          <Input inputMode="decimal" value={temperature} onChange={(e) => setTemperature(e.target.value)} placeholder="Standard des Anbieters" />
          <FieldError>{temperatureError}</FieldError>
          {rejectsTemperature.length > 0 ? (
            <FieldHint>
              Wird nicht gesendet an {rejectsTemperature.map((t) => getModelProfile(t.provider, t.model).label).join(", ")} – diese
              Modelle lehnen temperature ab.
            </FieldHint>
          ) : null}
        </Field>
        {paramsSet ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setMaxTokens("");
              setTemperature("");
            }}
          >
            <RotateCcw aria-hidden /> Zurücksetzen
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );

  const config = (
    <section aria-label="Lauf konfigurieren" className="space-y-4 rounded-lg border border-border bg-card p-4 shadow-xs">
      <Tabs value={mode} onValueChange={(v) => setMode(v as "single" | "compare")}>
        <TabsList variant="pill" className="h-11 md:h-8">
          <TabsTrigger value="single">Einzeln</TabsTrigger>
          <TabsTrigger value="compare">Vergleich</TabsTrigger>
        </TabsList>
        <TabsContent value="single" className="pt-4">
          <ModelSelect provider={single.provider} model={single.model} onChange={updateSingle} />
        </TabsContent>
        <TabsContent value="compare" className="space-y-3 pt-3">
          <p className="text-ui text-muted-foreground">Gleicher Prompt, bis zu 3 Modelle nebeneinander.</p>
          {columns === null ? (
            <p className="flex items-center gap-2 text-ui text-muted-foreground">
              <Spinner /> Verfügbare Modelle werden ermittelt …
            </p>
          ) : (
            <ol className="space-y-3">
              {columns.map((c, i) => (
                <li key={c.key} className="rounded-md border border-border bg-surface p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Spalte {i + 1}</span>
                    <IconButton
                      aria-label={`Spalte ${i + 1} entfernen`}
                      variant="danger-ghost"
                      size="icon-sm"
                      className="-my-1.5 size-10 md:my-0 md:size-7"
                      onClick={() => setColumns((cols) => (cols ?? []).filter((x) => x.key !== c.key))}
                      disabledReason={columns.length <= 1 ? "Mindestens ein Modell" : undefined}
                    >
                      <Trash2 />
                    </IconButton>
                  </div>
                  <ModelSelect
                    label={`Spalte ${i + 1}`}
                    provider={c.provider}
                    model={c.model}
                    onChange={(next) => updateColumn(c.key, next)}
                  />
                </li>
              ))}
            </ol>
          )}
          {columns !== null ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setColumns((cols) => [...(cols ?? []), { key: newKey(), provider: activeProvider, model: activeModel }])}
              disabledReason={columns.length >= MAX_COLUMNS ? "Höchstens 3 Modelle" : undefined}
            >
              <Plus aria-hidden /> Modell hinzufügen
            </Button>
          ) : null}
        </TabsContent>
      </Tabs>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        {running ? (
          <Button variant="outline" size="lg" onClick={stopAll} className="flex-1 sm:flex-none">
            <Square aria-hidden /> Abbrechen
          </Button>
        ) : (
          <Button
            variant="primary"
            size="lg"
            onClick={() => void handleRun()}
            // The shortcut is shown next to the button: a Kbd on the primary
            // fill measures 4.0:1 in dark mode (reported to P1).
            aria-keyshortcuts={isApple ? "Meta+Enter" : "Control+Enter"}
            disabledReason={runBlockedReason}
            className="flex-1 sm:flex-none"
          >
            <FlaskConical aria-hidden /> Ausführen
          </Button>
        )}
        {paramsPopover}
        {runKbd && !running ? (
          <span className="ml-auto hidden text-xs text-subtle-foreground md:inline">
            <Kbd>{runKbd}</Kbd> zum Ausführen
          </span>
        ) : null}
      </div>
    </section>
  );

  const resultsArea =
    results.length === 0 ? (
      <div className="rounded-lg border border-dashed border-border-strong">
        <EmptyState
          headingLevel={3}
          icon={<FlaskConical />}
          title="Ergebnis erscheint hier"
          description={runKbd ? `${runKbd} zum Ausführen` : "Mit „Ausführen“ starten"}
        />
      </div>
    ) : isMobile && results.length > 1 ? (
      <Tabs value={resultTab || results[0].key} onValueChange={setResultTab}>
        <TabsList variant="pill" className="h-11 max-w-full">
          {results.map((r, i) => (
            <TabsTrigger key={r.key} value={r.key}>
              {i + 1}. {providerName(r.provider)}
            </TabsTrigger>
          ))}
        </TabsList>
        {results.map((r) => (
          <TabsContent key={r.key} value={r.key} className="pt-3">
            <ResultCard r={r} onStop={() => controllers.current.get(r.key)?.abort()} />
          </TabsContent>
        ))}
      </Tabs>
    ) : (
      <div
        className={cn(
          "grid grid-cols-1 gap-3",
          results.length === 2 && "md:grid-cols-2",
          results.length >= 3 && "md:grid-cols-2 xl:grid-cols-3",
        )}
      >
        {results.map((r) => (
          <ResultCard key={r.key} r={r} onStop={() => controllers.current.get(r.key)?.abort()} />
        ))}
      </div>
    );

  const resultsSection = (
    <section aria-labelledby="pg-results" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id="pg-results" className="text-ui font-semibold">
          Ergebnisse
        </h2>
        {results.length > 0 && !running ? (
          <Button variant="ghost" size="sm" onClick={() => setResults([])}>
            <Trash2 aria-hidden /> Leeren
          </Button>
        ) : null}
      </div>
      <div aria-live="polite" className="sr-only">
        {running ? "Lauf gestartet" : results.length > 0 ? "Ergebnis fertig" : ""}
      </div>
      {resultsArea}
    </section>
  );

  return (
    <div className="mx-auto w-full max-w-[1400px]">
      <PageHeader
        title="Playground"
        description="Prompts gegen ein oder mehrere Modelle testen – mit Dauer, Tokens und Kosten."
        actions={
          <Button
            variant="outline"
            onClick={openSave}
            disabledReason={!xmlContent.trim() ? "Erst einen Prompt eingeben" : undefined}
          >
            <Library aria-hidden /> In Bibliothek speichern
          </Button>
        }
      />

      {isMobile ? (
        <div className="space-y-4">
          <SegmentedControl
            value={view}
            onValueChange={(v) => setView(v as "prompt" | "result")}
            stretch
            aria-label="Ansicht"
            className="h-11"
          >
            <SegmentedItem value="prompt">Prompt</SegmentedItem>
            <SegmentedItem value="result">
              Ergebnis
              {results.length > 0 ? <span className="tabular-nums text-subtle-foreground">{results.length}</span> : null}
            </SegmentedItem>
          </SegmentedControl>
          {view === "prompt" ? (
            <>
              {editor}
              {config}
            </>
          ) : (
            resultsSection
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="min-w-0">{editor}</div>
            <div className="min-w-0 space-y-6">
              {config}
              {/* A comparison gets the full width, so its columns sit side by side. */}
              {results.length > 1 ? null : resultsSection}
            </div>
          </div>
          {results.length > 1 ? <div className="mt-6">{resultsSection}</div> : null}
        </>
      )}

      <SavePromptDialog open={saveOpen} onClose={() => setSaveOpen(false)} />
    </div>
  );
}
