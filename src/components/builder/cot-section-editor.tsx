"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import { useBuilderStore } from "@/stores/builder-store";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ExampleEditor } from "./example-editor";
import { CountedLabel } from "./project-info-form";
import { fieldDomId } from "./lint-labels";
import { StepFooter } from "./step-footer";
import { syncXmlFromFields } from "./draft-sync";

const SECTIONS = [
  { key: "instructions", label: "Ziel / Anweisungen" },
  { key: "context", label: "Kontext" },
  { key: "constraints", label: "Rahmenbedingungen" },
  { key: "task", label: "Aufgabe" },
] as const;

export function CotSectionEditor({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const structured = useBuilderStore((s) => s.structured);
  const updateStructured = useBuilderStore((s) => s.updateStructured);

  // Keep the XML in step with the fields as they are edited (a field that was
  // only visited leaves a hand-edited XML alone).
  function syncXml() {
    syncXmlFromFields();
  }

  return (
    <section aria-labelledby="pb-step-title" className="space-y-5">
      <div>
        <h2 id="pb-step-title" className="text-lg font-semibold">
          Abschnitte
        </h2>
        <p className="text-ui text-muted-foreground">
          Feinschliff der einzelnen Abschnitte und Beispiele. Die Vorschau zeigt daraus das fertige XML.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {SECTIONS.map(({ key, label }) => (
          <Field key={key} id={fieldDomId(key)}>
            <CountedLabel count={structured[key].length}>{label}</CountedLabel>
            <Textarea
              autosize={{ min: 4, max: 16 }}
              value={structured[key]}
              onChange={(e) => updateStructured({ [key]: e.target.value })}
              onBlur={syncXml}
            />
          </Field>
        ))}
      </div>

      <ExampleEditor />

      <StepFooter>
        <Button variant="outline" size="lg" onClick={onBack}>
          <ArrowLeft aria-hidden /> Zurück
        </Button>
        <Button variant="primary" size="lg" onClick={onNext}>
          Weiter: Vorschau <ArrowRight aria-hidden />
        </Button>
      </StepFooter>
    </section>
  );
}
