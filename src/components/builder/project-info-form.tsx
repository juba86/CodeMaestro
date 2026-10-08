"use client";

import type { ReactNode } from "react";
import { useBuilderStore } from "@/stores/builder-store";
import { useSettingsStore } from "@/stores/settings-store";
import { buildXml } from "@/lib/prompt-engine/xml-builder";
import { generateCoTPrompt } from "@/lib/prompt-engine/cot-generator";
import { getApiKey } from "@/lib/ai/client-keys";
import { getProvider } from "@/lib/ai/catalog";
import { KnowledgeInsert } from "@/components/knowledge/knowledge-insert";
import type { PromptStructured } from "@/lib/ai/types";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Field, FieldHint, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { fieldDomId } from "./lint-labels";
import { StepFooter } from "./step-footer";
import { markXmlInSync } from "./draft-sync";

/**
 * Merges a generated prompt into the user's draft. The model only writes the
 * sections it produced: a section it left empty keeps the user's value, and
 * the technique (never echoed as <technique>) and swarm config (unless it
 * returned one) are preserved.
 */
function mergeGenerated(current: PromptStructured, generated: PromptStructured): PromptStructured {
  return {
    instructions: generated.instructions || current.instructions,
    context: generated.context || current.context,
    constraints: generated.constraints || current.constraints,
    targetAudience: generated.targetAudience || current.targetAudience,
    outputFormat: generated.outputFormat || current.outputFormat,
    task: generated.task || current.task,
    examples: generated.examples.length > 0 ? generated.examples : current.examples,
    technique: generated.technique ?? current.technique,
    swarmConfig: generated.swarmConfig ?? current.swarmConfig,
  };
}

/** Whether a parsed reply has any prompt text (a lone <technique> doesn't count). */
function hasPromptContent(p: PromptStructured): boolean {
  return (
    [p.instructions, p.context, p.constraints, p.targetAudience, p.outputFormat, p.task].some((v) => v.trim()) ||
    p.examples.length > 0
  );
}

/** Label row with a live character count. */
export function CountedLabel({ children, count, extra }: { children: ReactNode; count: number; extra?: ReactNode }) {
  return (
    <div className="flex min-h-6 items-center justify-between gap-2">
      <FieldLabel>{children}</FieldLabel>
      <span className="flex items-center gap-2">
        {extra}
        {count > 0 ? (
          <span className="text-xs tabular-nums text-subtle-foreground">
            {count.toLocaleString("de-DE")} Zeichen
          </span>
        ) : null}
      </span>
    </div>
  );
}

export function ProjectInfoForm({ onNext }: { onNext: () => void }) {
  const structured = useBuilderStore((s) => s.structured);
  const updateStructured = useBuilderStore((s) => s.updateStructured);
  const setXmlContent = useBuilderStore((s) => s.setXmlContent);
  const setStep = useBuilderStore((s) => s.setStep);
  const setIsGenerating = useBuilderStore((s) => s.setIsGenerating);
  const isGenerating = useBuilderStore((s) => s.isGenerating);
  const { activeProvider, activeModel } = useSettingsStore();

  const hasGoal = !!(structured.instructions.trim() || structured.task.trim());
  const providerName = getProvider(activeProvider)?.label ?? activeProvider;

  async function handleGenerate() {
    if (!structured.instructions.trim()) {
      toast.error("Gib zuerst ein Ziel an.");
      return;
    }
    setIsGenerating(true);
    try {
      const apiKey = await getApiKey(activeProvider);
      const result = await generateCoTPrompt(structured, activeProvider, activeModel, apiKey);
      if (!result || !hasPromptContent(result)) {
        toast.error("Die Antwort enthielt kein verwertbares Prompt-XML. Versuch es erneut oder mit einem anderen Modell.");
      } else {
        // Merge into the latest draft (the form stays editable while generating).
        const merged = mergeGenerated(useBuilderStore.getState().structured, result);
        updateStructured(merged);
        setXmlContent(buildXml(merged));
        markXmlInSync(merged);
        setStep("edit");
        toast.success("Prompt erstellt.");
      }
    } catch (err) {
      // The engine's own fallback message is English; the server's reason is shown as is.
      const reason = err instanceof Error && err.message !== "AI generation failed" ? err.message : "";
      toast.error(
        reason
          ? `Generieren fehlgeschlagen: ${reason}`
          : "Generieren fehlgeschlagen. Prüfe den API-Schlüssel in den Einstellungen.",
      );
      console.error(err);
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <section aria-labelledby="pb-step-title" className="space-y-5">
      <div>
        <h2 id="pb-step-title" className="text-lg font-semibold">
          Projektinformationen
        </h2>
        <p className="text-ui text-muted-foreground">
          Beschreibe Ziel und Rahmen. Mit KI generieren füllt die übrigen Abschnitte, manuell baust du sie selbst.
        </p>
      </div>

      <Field id={fieldDomId("instructions")} required>
        <CountedLabel count={structured.instructions.length}>Ziel / Anweisungen</CountedLabel>
        <Textarea
          autosize={{ min: 3, max: 14 }}
          placeholder="Was soll die KI tun? z. B. „Code auf Sicherheitslücken prüfen und Korrekturen vorschlagen“"
          value={structured.instructions}
          onChange={(e) => updateStructured({ instructions: e.target.value })}
        />
        <FieldHint>Die Hauptanweisung: was, wie und woran man erkennt, dass es gelungen ist.</FieldHint>
      </Field>

      <Field id={fieldDomId("context")}>
        <CountedLabel
          count={structured.context.length}
          extra={
            <KnowledgeInsert
              onInsert={(text) => {
                const ctx = useBuilderStore.getState().structured.context;
                updateStructured({ context: ctx ? `${ctx}\n\n${text}` : text });
              }}
            />
          }
        >
          Kontext
        </CountedLabel>
        <Textarea
          autosize={{ min: 2, max: 14 }}
          placeholder="Hintergrund, Tech-Stack, Projektdetails …"
          value={structured.context}
          onChange={(e) => updateStructured({ context: e.target.value })}
        />
      </Field>

      <Field id={fieldDomId("constraints")}>
        <CountedLabel count={structured.constraints.length}>Rahmenbedingungen</CountedLabel>
        <Textarea
          autosize={{ min: 2, max: 14 }}
          placeholder="Regeln, Grenzen, was zu vermeiden ist – am besten jeweils mit Grund"
          value={structured.constraints}
          onChange={(e) => updateStructured({ constraints: e.target.value })}
        />
      </Field>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field id={fieldDomId("targetAudience")}>
          <FieldLabel>Zielgruppe</FieldLabel>
          <Input
            placeholder="z. B. erfahrene Entwickler:innen"
            value={structured.targetAudience}
            onChange={(e) => updateStructured({ targetAudience: e.target.value })}
          />
        </Field>
        <Field id={fieldDomId("outputFormat")}>
          <FieldLabel>Ausgabeformat</FieldLabel>
          <Input
            placeholder="z. B. Markdown, JSON, XML"
            value={structured.outputFormat}
            onChange={(e) => updateStructured({ outputFormat: e.target.value })}
          />
        </Field>
      </div>

      <Field id={fieldDomId("task")}>
        <CountedLabel count={structured.task.length}>Aufgabe</CountedLabel>
        <Textarea
          autosize={{ min: 2, max: 14 }}
          placeholder="Die konkrete Aufgabe, die ausgeführt werden soll …"
          value={structured.task}
          onChange={(e) => updateStructured({ task: e.target.value })}
        />
      </Field>

      <StepFooter>
        <Button
          variant="primary"
          size="lg"
          onClick={handleGenerate}
          loading={isGenerating}
          disabledReason={!structured.instructions.trim() ? "Erst ein Ziel angeben" : undefined}
        >
          {isGenerating ? null : <Sparkles aria-hidden />}
          {isGenerating ? "Wird generiert …" : "Mit KI generieren"}
        </Button>
        <Button
          variant="outline"
          size="lg"
          onClick={onNext}
          disabledReason={!hasGoal ? "Erst ein Ziel angeben" : undefined}
        >
          Manuell aufbauen
        </Button>
        <p className="hidden text-xs text-muted-foreground md:block md:basis-full">
          Generiert mit {providerName}
          {activeModel ? ` · ${activeModel}` : ""} – änderbar in den Einstellungen.
        </p>
      </StepFooter>
    </section>
  );
}
