"use client";

import { useState, useMemo } from "react";
import { useBuilderStore } from "@/stores/builder-store";
import { useSettingsStore } from "@/stores/settings-store";
import {
  recommendTechniques,
  techniques,
  type TechniqueCategory,
  type TechniqueInfo,
} from "@/lib/prompt-engine/techniques";
import { getModelProfile, type ModelProfile } from "@/lib/prompt-engine/model-profile";
import { parseXmlPartial } from "@/lib/prompt-engine/xml-parser";
import { uid } from "@/lib/uid";
import type { PromptStructured, PromptTechnique } from "@/lib/ai/types";
import { ExternalLink, ClipboardPlus } from "lucide-react";
import { toast } from "sonner";

const complexityColor: Record<string, string> = {
  low: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  high: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

const COMPLEXITY_LABEL: Record<TechniqueInfo["complexity"], string> = {
  low: "einfach",
  medium: "mittel",
  high: "aufwendig",
};

const CATEGORIES: { id: TechniqueCategory; label: string }[] = [
  { id: "agentic", label: "Agentisches Arbeiten" },
  { id: "quality", label: "Qualität & Prüfung" },
  { id: "structure", label: "Struktur & Kontext" },
  { id: "reasoning", label: "Denkansätze" },
];

// Where "Einfügen" puts a technique's snippet. Only multi-line fields that both
// the form and the section editor show are targets.
type SnippetTarget = "instructions" | "context" | "constraints" | "examples" | "documents";

const SNIPPET_TARGET: Partial<Record<PromptTechnique, SnippetTarget>> = {
  // Checks, stop conditions, loop bounds and guardrails apply to the whole run.
  "verification-loop": "constraints",
  "definition-of-done": "constraints",
  "completion-promise-loop": "constraints",
  "scoped-autonomy": "constraints",
  "evaluator-optimizer": "constraints",
  constitutional: "constraints",
  "structured-output": "constraints",
  "self-consistency": "constraints",
  // Project facts.
  "context-engineering": "context",
  // Documents go to the context (rendered first), the question to the task
  // (rendered last).
  "long-context-grounding": "documents",
  // The builder's own <examples> section: becomes example entries.
  "few-shot-cot": "examples",
};

const TARGET_HINT: Record<SnippetTarget, string> = {
  instructions: "Hängt den Baustein an „Instructions“ an — er beschreibt, wie gearbeitet werden soll.",
  context: "Hängt den Baustein an „Context“ an — Projektfakten gehören in den Kontext.",
  documents:
    "Legt die Dokumente in „Context“ ab, der im Prompt zuerst kommt, und hängt Anweisung und Frage an „Task“ an, der zuletzt kommt — so steht die Frage nach dem langen Material.",
  constraints:
    "Hängt den Baustein an „Constraints“ an — Prüf-, Abbruch- und Sicherheitsregeln gelten für die ganze Arbeit, nicht nur für einen Schritt.",
  examples:
    "Legt Beispiel-Gerüste unter „Beispiele“ an (Eingabe, Lösungsweg, Antwort); der Hinweis zur Verwendung kommt zu den „Instructions“.",
};

function targetFor(id: PromptTechnique): SnippetTarget {
  return SNIPPET_TARGET[id] ?? "instructions";
}

function appendBlock(current: string, block: string): string {
  return current.trim() ? `${current.trimEnd()}\n\n${block}` : block;
}

/**
 * The structured-field changes that insert a technique's snippet, or null when
 * the target already contains it.
 */
function snippetUpdate(t: TechniqueInfo, s: PromptStructured): Partial<PromptStructured> | null {
  const snippet = t.promptSnippet.trim();
  const target = targetFor(t.id);
  if (target === "documents") {
    const docs = snippet.match(/<documents(?:\s[^>]*)?>[\s\S]*?<\/documents\s*>/i)?.[0] ?? "";
    const rest = snippet.replace(docs, "").trim();
    const update: Partial<PromptStructured> = {};
    if (docs && !s.context.includes(docs)) update.context = appendBlock(s.context, docs);
    if (rest && !s.task.includes(rest)) update.task = appendBlock(s.task, rest);
    return Object.keys(update).length > 0 ? update : null;
  }
  if (target !== "examples") {
    if (s[target].includes(snippet)) return null;
    return { [target]: appendBlock(s[target], snippet) };
  }
  const examples = (parseXmlPartial(snippet).examples ?? []).map((e) => ({ ...e, id: uid() }));
  const note = snippet.replace(/<examples(?:\s[^>]*)?>[\s\S]*?<\/examples\s*>/i, "").trim();
  const update: Partial<PromptStructured> = {};
  // The scaffolds are placeholders: add them once.
  const already = examples.some((e) => s.examples.some((x) => x.input === e.input));
  if (examples.length > 0 && !already) update.examples = [...s.examples, ...examples];
  if (note && !s.instructions.includes(note)) update.instructions = appendBlock(s.instructions, note);
  return Object.keys(update).length > 0 ? update : null;
}

function isLegacyFor(t: TechniqueInfo, profile: ModelProfile): boolean {
  return !!t.legacy && profile.adaptiveThinking;
}

export function TechniqueRecommender() {
  const { structured, updateStructured } = useBuilderStore();
  const { activeProvider, activeModel } = useSettingsStore();
  const [onlyRecommended, setOnlyRecommended] = useState(true);

  const profile = useMemo(() => getModelProfile(activeProvider, activeModel), [activeProvider, activeModel]);
  const legacyLabel = `veraltet für ${profile.family === "claude5" ? "Claude 5" : profile.label}`;

  const taskText = `${structured.instructions} ${structured.task} ${structured.context}`.trim();

  const recommended = useMemo(() => {
    if (!taskText) return [];
    const hasExamples = structured.examples.length > 0;
    const isAgentic = !!structured.swarmConfig;
    return recommendTechniques(taskText, hasExamples, isAgentic, false, profile);
  }, [taskText, structured.examples.length, structured.swarmConfig, profile]);

  const rank = useMemo(() => new Map(recommended.map((t, i) => [t.id, i + 1])), [recommended]);
  const filtered = onlyRecommended && recommended.length > 0;

  const selectedTechnique = structured.technique;

  // Recommended techniques lead their category, in recommendation order; the
  // selected one stays visible when the list is filtered.
  const groups = useMemo(
    () =>
      CATEGORIES.map((c) => ({
        ...c,
        items: techniques
          .filter((t) => t.category === c.id && (!filtered || rank.has(t.id) || t.id === selectedTechnique))
          .sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99)),
      })).filter((g) => g.items.length > 0),
    [filtered, rank, selectedTechnique]
  );

  function handleSelect(id: PromptTechnique) {
    updateStructured({ technique: selectedTechnique === id ? undefined : id });
  }

  function handleInsert(t: TechniqueInfo) {
    // The store's current draft, not this render's snapshot.
    const update = snippetUpdate(t, useBuilderStore.getState().structured);
    if (!update) {
      toast.info(`„${t.name}“ ist bereits im Prompt enthalten.`);
      return;
    }
    updateStructured(update);
    toast.success(
      t.promptSnippet.includes("{{")
        ? "Baustein eingefügt — ersetze die {{PLATZHALTER}} durch deine Werte."
        : "Baustein eingefügt."
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Technik</h3>
        {recommended.length > 0 && (
          <button
            onClick={() => setOnlyRecommended(!onlyRecommended)}
            className="text-xs text-primary hover:underline"
          >
            {filtered ? "Alle anzeigen" : "Nur empfohlene"}
          </button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {taskText
          ? filtered
            ? `Empfohlen für deine Aufgabe und ${profile.label}:`
            : recommended.length > 0
              ? `Alle Techniken nach Kategorie — Empfehlungen für ${profile.label} sind markiert.`
              : "Für diese Aufgabe drängt sich keine Technik auf — alle Techniken nach Kategorie:"
          : `Gib Ziel oder Aufgabe ein, um Empfehlungen für ${profile.label} zu bekommen.`}
      </p>

      <div className="space-y-4 max-h-[520px] overflow-y-auto pr-1">
        {groups.map((g) => (
          <section key={g.id} className="space-y-2">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {g.label}
            </h4>
            {g.items.map((t) => {
              const selected = selectedTechnique === t.id;
              const r = rank.get(t.id);
              const legacy = isLegacyFor(t, profile);
              return (
                <div
                  key={t.id}
                  className={`rounded-lg border transition-colors ${
                    selected
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : r
                        ? "border-primary/50 bg-primary/[0.03] hover:border-primary"
                        : "border-border hover:border-primary/40"
                  } ${legacy && !selected ? "opacity-75" : ""}`}
                >
                  <button
                    onClick={() => handleSelect(t.id)}
                    aria-pressed={selected}
                    className="w-full text-left p-3 pb-2"
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <span className="text-sm font-medium">{t.name}</span>
                      <span
                        className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded ${complexityColor[t.complexity]}`}
                        title="Aufwand beim Einsatz"
                      >
                        {COMPLEXITY_LABEL[t.complexity]}
                      </span>
                    </div>
                    {(r || legacy) && (
                      <div className="flex flex-wrap gap-1 mb-1.5">
                        {r && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-medium">
                            Empfohlen · {r}
                          </span>
                        )}
                        {legacy && (
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 font-medium"
                            title={`${profile.label} denkt von sich aus (adaptives Denken): Die Denktiefe steuerst du über die Effort-Einstellung, nicht über Prompt-Text.${
                              profile.reasoningExtractionRisk
                                ? " Prompts, die sichtbares Nachdenken verlangen, können dort sogar abgelehnt werden (reasoning_extraction)."
                                : ""
                            }`}
                          >
                            {legacyLabel}
                          </span>
                        )}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground mb-1.5">{t.description}</p>
                    <div className="flex items-center gap-1 flex-wrap">
                      {t.bestFor.slice(0, 3).map((bf) => (
                        <span
                          key={bf}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-accent text-muted-foreground"
                        >
                          {bf}
                        </span>
                      ))}
                    </div>
                    <p className="mt-1.5 text-[10px] text-muted-foreground line-clamp-2" title={t.accuracyGain}>
                      {t.accuracyGain}
                    </p>
                  </button>
                  <div className="flex items-center gap-3 px-3 pb-2 text-xs">
                    {/* A legacy snippet is exactly what this model should do without. */}
                    <button
                      onClick={() => handleInsert(t)}
                      disabled={legacy}
                      title={
                        legacy
                          ? `Für ${profile.label} nicht nötig: Die Denktiefe stellst du über die Effort-Einstellung ein, nicht per Prompt-Text.`
                          : `${TARGET_HINT[targetFor(t.id)]} Platzhalter wie {{CHECK_COMMAND}} danach ersetzen.`
                      }
                      className="flex items-center gap-1 text-primary hover:underline disabled:text-muted-foreground disabled:no-underline disabled:cursor-not-allowed"
                    >
                      <ClipboardPlus size={12} /> Einfügen
                    </button>
                    <a
                      href={t.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"
                      title={t.sourceUrl}
                    >
                      <ExternalLink size={12} /> Quelle
                    </a>
                  </div>
                </div>
              );
            })}
          </section>
        ))}
      </div>

      {selectedTechnique && (
        <div className="text-xs text-muted-foreground pt-1 border-t border-border">
          Ausgewählt: <strong>{techniques.find((t) => t.id === selectedTechnique)?.name}</strong>
          {" — "}fließt in den generierten Prompt ein.
        </div>
      )}
    </div>
  );
}
