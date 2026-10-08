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
import { Check, ChevronDown, ClipboardPlus, ExternalLink, Lightbulb, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { COMPLEXITY_LABEL, TECHNIQUE_CATEGORY_LABEL, techniqueCopy } from "./technique-labels";
import { modelLabel } from "./prompt-quality-panel";
import { updateDraft } from "./draft-sync";

const CATEGORIES: TechniqueCategory[] = ["agentic", "quality", "structure", "reasoning"];

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
  instructions: "Hängt den Baustein an „Ziel / Anweisungen“ an – er beschreibt, wie gearbeitet werden soll.",
  context: "Hängt den Baustein an „Kontext“ an – Projektfakten gehören in den Kontext.",
  documents:
    "Legt die Dokumente in „Kontext“ ab, der im Prompt zuerst kommt, und hängt Anweisung und Frage an „Aufgabe“ an, die zuletzt kommt – so steht die Frage nach dem langen Material.",
  constraints:
    "Hängt den Baustein an „Rahmenbedingungen“ an – Prüf-, Abbruch- und Sicherheitsregeln gelten für die ganze Arbeit, nicht nur für einen Schritt.",
  examples:
    "Legt Beispiel-Gerüste unter „Beispiele“ an (Eingabe, Lösungsweg, Antwort); der Hinweis zur Verwendung kommt zu „Ziel / Anweisungen“.",
};

/** Example goals for the empty state; each one triggers a different recommendation. */
const EXAMPLE_GOALS: { label: string; text: string }[] = [
  {
    label: "Bug mit Test beheben",
    text: "Finde und behebe den Fehler in der Login-Route. Reproduziere ihn zuerst mit einem fehlschlagenden Test.",
  },
  {
    label: "Code-Review",
    text: "Prüfe den Pull Request auf Sicherheitslücken und Fehler (Code-Review).",
  },
  {
    label: "Migration im Loop",
    text: "Migriere alle API-Aufrufe autonom im Loop auf den neuen Client, bis die Tests grün sind.",
  },
];

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

function TechniqueCard({
  t,
  rank,
  selected,
  legacy,
  legacyLabel,
  profile,
  onSelect,
  onInsert,
}: {
  t: TechniqueInfo;
  rank?: number;
  selected: boolean;
  legacy: boolean;
  legacyLabel: string;
  profile: ModelProfile;
  onSelect: () => void;
  onInsert: () => void;
}) {
  const [open, setOpen] = useState(false);
  const copy = techniqueCopy(t);
  const model = modelLabel(profile);
  const detailsId = `pb-tech-${t.id}-details`;
  return (
    <li
      className={cn(
        "rounded-lg border bg-card transition-colors duration-150",
        selected
          ? "border-transparent ring-2 ring-ring"
          : rank
            ? "border-primary-border"
            : "border-border hover:border-border-strong",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className="block w-full rounded-t-lg p-3 pb-2 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        <span className="flex items-start justify-between gap-2">
          <span className={cn("text-ui font-medium", legacy && !selected ? "text-muted-foreground" : "text-foreground")}>
            {copy.name}
          </span>
          {selected ? (
            <Badge variant="brand" icon={<Check aria-hidden />}>
              gewählt
            </Badge>
          ) : (
            <Badge variant="outline">
              <span className="sr-only">Aufwand: </span>
              {COMPLEXITY_LABEL[t.complexity]}
            </Badge>
          )}
        </span>
        {rank || legacy ? (
          <span className="mt-1.5 flex flex-wrap gap-1">
            {rank ? <Badge variant="brand">Empfohlen · {rank}</Badge> : null}
            {legacy ? <Badge variant="warning">{legacyLabel}</Badge> : null}
          </span>
        ) : null}
        <span className="mt-1.5 line-clamp-3 text-xs text-muted-foreground">{copy.description}</span>
      </button>
      {open ? (
        <div id={detailsId} className="space-y-1.5 px-3 pb-2 text-xs">
          {legacy ? (
            <p className="text-warning">
              {model} denkt von sich aus (adaptives Denken): Die Denktiefe steuerst du über die Effort-Einstellung, nicht
              über Prompt-Text.
              {profile.reasoningExtractionRisk
                ? " Prompts, die sichtbares Nachdenken verlangen, können dort sogar abgelehnt werden."
                : ""}
            </p>
          ) : null}
          <p className="text-foreground/90">
            <span className="font-medium text-foreground">Wirkung: </span>
            {copy.gain}
          </p>
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">Geeignet für: </span>
            {copy.bestFor.join(" · ")}
          </p>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 px-1.5 pb-1.5">
        {/* A legacy snippet is exactly what this model should do without. */}
        <Button
          // Remount when blocking changes: the reason and the tooltip are different tooltip modes.
          key={legacy ? "blocked" : "ready"}
          variant="ghost"
          size="sm"
          className="h-10 text-primary-text md:h-6 md:px-2"
          onClick={onInsert}
          disabledReason={
            legacy
              ? `Für ${model} nicht nötig: Die Denktiefe stellst du über die Effort-Einstellung ein, nicht per Prompt-Text.`
              : undefined
          }
          tooltip={`${TARGET_HINT[targetFor(t.id)]} Platzhalter wie {{CHECK_COMMAND}} danach ersetzen.`}
        >
          <ClipboardPlus aria-hidden className="size-3.5" /> Einfügen
          <span className="sr-only"> ({copy.name})</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-10 md:h-6 md:px-2"
          aria-expanded={open}
          aria-controls={open ? detailsId : undefined}
          onClick={() => setOpen((v) => !v)}
        >
          Details
          <span className="sr-only"> zu {copy.name}</span>
          <ChevronDown aria-hidden className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        </Button>
        <a
          href={t.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex h-10 items-center gap-1 rounded-md px-2.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:h-6 md:px-2"
        >
          <ExternalLink aria-hidden className="size-3" /> Quelle
          <span className="sr-only"> zu {copy.name} (öffnet in neuem Tab)</span>
        </a>
      </div>
    </li>
  );
}

/** Rail card „Technik-Empfehlung". */
export function TechniqueRecommender({ onExampleGoal }: { onExampleGoal?: () => void }) {
  const structured = useBuilderStore((s) => s.structured);
  const activeProvider = useSettingsStore((s) => s.activeProvider);
  const activeModel = useSettingsStore((s) => s.activeModel);
  const [onlyRecommended, setOnlyRecommended] = useState(true);
  const [browseAll, setBrowseAll] = useState(false);

  const profile = useMemo(() => getModelProfile(activeProvider, activeModel), [activeProvider, activeModel]);
  const model = modelLabel(profile);
  const legacyLabel = `veraltet für ${profile.family === "claude5" ? "Claude 5" : model}`;

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
  const selectedInfo = techniques.find((t) => t.id === selectedTechnique);
  const showList = !!taskText || browseAll || !!selectedTechnique;

  // Recommended techniques lead their category, in recommendation order; the
  // selected one stays visible when the list is filtered.
  const groups = useMemo(
    () =>
      CATEGORIES.map((id) => ({
        id,
        label: TECHNIQUE_CATEGORY_LABEL[id],
        items: techniques
          .filter((t) => t.category === id && (!filtered || rank.has(t.id) || t.id === selectedTechnique))
          .sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99)),
      })).filter((g) => g.items.length > 0),
    [filtered, rank, selectedTechnique],
  );

  // Changes go through updateDraft: on Vorschau and Verfeinern they show up
  // in the XML right away.
  function handleSelect(id: PromptTechnique) {
    updateDraft((cur) => ({ technique: cur.technique === id ? undefined : id }));
  }

  function handleInsert(t: TechniqueInfo) {
    // Against the store's current draft (or its XML), not this render's snapshot.
    const name = techniqueCopy(t).name;
    if (!updateDraft((cur) => snippetUpdate(t, cur))) {
      toast.info(`„${name}“ ist bereits im Prompt enthalten.`);
      return;
    }
    toast.success(
      t.promptSnippet.includes("{{")
        ? "Baustein eingefügt – ersetze die {{PLATZHALTER}} durch deine Werte."
        : "Baustein eingefügt.",
    );
  }

  function applyExample(text: string) {
    updateDraft(() => ({ instructions: text }));
    onExampleGoal?.();
  }

  return (
    <section aria-labelledby="pb-tech-title" className="rounded-lg border border-border bg-card shadow-xs">
      <div className="flex items-start justify-between gap-2 p-4 pb-2">
        <div className="min-w-0">
          <h2 id="pb-tech-title" className="text-ui font-semibold">
            Technik-Empfehlung
          </h2>
          {showList ? (
            <p className="text-xs text-muted-foreground">
              {taskText
                ? filtered
                  ? `Passend zu deiner Aufgabe und ${model}.`
                  : recommended.length > 0
                    ? `Alle Techniken – Empfehlungen für ${model} sind markiert.`
                    : "Keine Technik drängt sich auf – alle Techniken nach Kategorie."
                : "Alle Techniken nach Kategorie."}
            </p>
          ) : null}
        </div>
        {recommended.length > 0 ? (
          <Button
            variant="link"
            size="xs"
            className="-mr-1 h-10 shrink-0 px-1 text-xs md:h-6"
            onClick={() => setOnlyRecommended(!onlyRecommended)}
          >
            {filtered ? "Alle anzeigen" : "Nur empfohlene"}
          </Button>
        ) : null}
      </div>

      {selectedInfo ? (
        <div className="mx-4 mb-2 flex items-start gap-2 rounded-md border border-primary-border bg-primary-subtle px-3 py-2 text-xs">
          <p className="min-w-0 flex-1 text-foreground">
            Gewählt: <span className="font-medium">{techniqueCopy(selectedInfo).name}</span> – fließt in den generierten
            Prompt ein.
          </p>
          <Button
            variant="ghost"
            size="icon-sm"
            className="-my-2 -mr-2 size-10 md:-my-1 md:-mr-1.5 md:size-6"
            aria-label="Technik abwählen"
            onClick={() => updateDraft(() => ({ technique: undefined }))}
          >
            <X />
          </Button>
        </div>
      ) : null}

      {!showList ? (
        <div className="px-4 pb-4">
          <div className="flex items-start gap-2.5 rounded-md bg-surface-2 p-3">
            <Lightbulb aria-hidden className="mt-0.5 size-4 shrink-0 text-subtle-foreground" />
            <p className="text-ui text-muted-foreground">Beschreibe dein Ziel – wir schlagen passende Techniken vor.</p>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Zum Ausprobieren:</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {EXAMPLE_GOALS.map((g) => (
              <Button key={g.label} variant="outline" size="sm" className="h-10 md:h-7" onClick={() => applyExample(g.text)}>
                {g.label}
              </Button>
            ))}
          </div>
          <Button variant="link" size="xs" className="mt-1 h-10 text-xs md:mt-3 md:h-6" onClick={() => setBrowseAll(true)}>
            Alle {techniques.length} Techniken ansehen
          </Button>
        </div>
      ) : (
        <div className="space-y-4 px-4 pb-4 pt-1">
          {groups.map((g) => (
            <section key={g.id} aria-label={g.label} className="space-y-2">
              <h3 className="text-xs font-medium text-subtle-foreground">{g.label}</h3>
              <ul className="space-y-2">
                {g.items.map((t) => (
                  <TechniqueCard
                    key={t.id}
                    t={t}
                    rank={rank.get(t.id)}
                    selected={selectedTechnique === t.id}
                    legacy={isLegacyFor(t, profile)}
                    legacyLabel={legacyLabel}
                    profile={profile}
                    onSelect={() => handleSelect(t.id)}
                    onInsert={() => handleInsert(t)}
                  />
                ))}
              </ul>
            </section>
          ))}
          {!taskText && browseAll && !selectedTechnique ? (
            <Button variant="link" size="xs" className="h-10 text-xs md:h-6" onClick={() => setBrowseAll(false)}>
              Liste schließen
            </Button>
          ) : null}
        </div>
      )}
    </section>
  );
}
