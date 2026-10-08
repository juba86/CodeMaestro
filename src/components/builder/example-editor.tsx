"use client";

import { useBuilderStore } from "@/stores/builder-store";
import { uid } from "@/lib/uid";
import { Plus, Trash2 } from "lucide-react";
import { Field, FieldHint, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { Button, IconButton } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { fieldDomId } from "./lint-labels";

export function ExampleEditor() {
  const examples = useBuilderStore((s) => s.structured.examples);
  const addExample = useBuilderStore((s) => s.addExample);
  const updateExample = useBuilderStore((s) => s.updateExample);
  const removeExample = useBuilderStore((s) => s.removeExample);
  const count = examples.length;

  function handleAdd() {
    const id = uid();
    addExample({ id, input: "", thinking: "", answer: "" });
    // Put the cursor into the new example's first field.
    requestAnimationFrame(() => document.getElementById(`pb-example-${id}-input`)?.focus());
  }

  return (
    <section aria-labelledby={fieldDomId("examples")} className="space-y-3 border-t border-border pt-5">
      <div className="flex items-center justify-between gap-2">
        <h3 id={fieldDomId("examples")} tabIndex={-1} className="text-ui font-semibold outline-none">
          Beispiele <span className="font-normal tabular-nums text-subtle-foreground">({count})</span>
        </h3>
        <Button variant="outline" size="sm" onClick={handleAdd}>
          <Plus aria-hidden /> Beispiel hinzufügen
        </Button>
      </div>

      <p className="max-w-[70ch] text-ui text-muted-foreground">
        Empfohlen sind 3–5 Beispiele, die echten Eingaben ähneln und sich deutlich unterscheiden (auch Randfälle), damit
        das Modell kein ungewolltes Muster kopiert. Starte mit einem und ergänze weitere, wenn die Ausgaben danebenliegen.
      </p>
      {count > 5 ? (
        <Callout variant="warning">Mehr als 5 Beispiele bringen selten mehr – lieber wenige, gut gewählte.</Callout>
      ) : null}

      {examples.map((ex, idx) => (
        <div key={ex.id} role="group" aria-label={`Beispiel ${idx + 1}`} className="space-y-3 rounded-lg border border-border bg-card p-3 md:p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Beispiel {idx + 1}</span>
            <IconButton
              aria-label={`Beispiel ${idx + 1} entfernen`}
              variant="danger-ghost"
              size="icon-sm"
              className="-my-1.5 -mr-1.5 size-10 md:my-0 md:mr-0 md:size-7"
              onClick={() => removeExample(ex.id)}
            >
              <Trash2 />
            </IconButton>
          </div>
          <Field id={`pb-example-${ex.id}-input`}>
            <FieldLabel>Eingabe</FieldLabel>
            <Textarea
              autosize={{ min: 2, max: 10 }}
              value={ex.input}
              onChange={(e) => updateExample(ex.id, { input: e.target.value })}
              placeholder="Beispiel-Eingabe …"
            />
          </Field>
          <Field>
            <FieldLabel optional="optional">Lösungsweg (Begründung)</FieldLabel>
            <FieldHint>
              Erscheint im Beispiel als &lt;method&gt;: eine kurze Erklärung, wie man zur Antwort kommt. Beschreibe den Ansatz
              knapp statt einer langen Gedankenkette – das Beispiel soll die Methode zeigen, nicht das Modell zum
              Mitschreiben seines Denkens auffordern.
            </FieldHint>
            <Textarea
              autosize={{ min: 2, max: 10 }}
              className="font-mono md:text-xs"
              value={ex.thinking}
              onChange={(e) => updateExample(ex.id, { thinking: e.target.value })}
              placeholder="z. B. Fehlermeldung zeigt auf Null-Zugriff → Guard vor dem Aufruf ergänzen."
            />
          </Field>
          <Field>
            <FieldLabel>Antwort</FieldLabel>
            <Textarea
              autosize={{ min: 2, max: 10 }}
              value={ex.answer}
              onChange={(e) => updateExample(ex.id, { answer: e.target.value })}
              placeholder="Erwartete Antwort …"
            />
          </Field>
        </div>
      ))}

      {count === 0 ? (
        <p className="rounded-lg border border-dashed border-border-strong px-4 py-6 text-center text-ui text-muted-foreground">
          Noch keine Beispiele. Gute Beispiele sind einer der zuverlässigsten Wege, Format und Stil der Antwort zu steuern.
        </p>
      ) : null}
    </section>
  );
}
