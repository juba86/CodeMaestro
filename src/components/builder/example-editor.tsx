"use client";

import { useBuilderStore } from "@/stores/builder-store";
import { uid } from "@/lib/uid";
import { Plus, Trash2 } from "lucide-react";

export function ExampleEditor() {
  const { structured, addExample, updateExample, removeExample } = useBuilderStore();
  const count = structured.examples.length;

  function handleAdd() {
    addExample({
      id: uid(),
      input: "",
      thinking: "",
      answer: "",
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Beispiele ({count})</h3>
        <button
          onClick={handleAdd}
          className="text-sm flex items-center gap-1 px-2 py-1 rounded hover:bg-accent"
        >
          <Plus size={14} /> Beispiel hinzufügen
        </button>
      </div>

      <p className="text-xs text-muted-foreground">
        Empfohlen sind 3–5 Beispiele, die echten Eingaben ähneln und sich deutlich unterscheiden
        (auch Randfälle), damit das Modell kein ungewolltes Muster kopiert. Starte mit einem und
        ergänze weitere, wenn die Ausgaben danebenliegen.
        {count > 5 && (
          <span className="block mt-1 text-amber-500">
            Mehr als 5 Beispiele bringen selten mehr — lieber wenige, gut gewählte.
          </span>
        )}
      </p>

      {structured.examples.map((ex, idx) => (
        <div key={ex.id} className="border border-border rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Beispiel {idx + 1}</span>
            <button
              onClick={() => removeExample(ex.id)}
              className="p-1 text-muted-foreground hover:text-destructive"
              aria-label={`Beispiel ${idx + 1} entfernen`}
            >
              <Trash2 size={14} />
            </button>
          </div>
          <div>
            <label className="text-xs font-medium">Eingabe</label>
            <textarea
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[40px] focus:outline-none focus:ring-2 focus:ring-ring"
              value={ex.input}
              onChange={(e) => updateExample(ex.id, { input: e.target.value })}
              placeholder="Beispiel-Eingabe..."
            />
          </div>
          <div>
            <label className="text-xs font-medium">Lösungsweg (Begründung)</label>
            <p className="text-[11px] text-muted-foreground">
              Optional. Erscheint im Beispiel als &lt;method&gt;: eine kurze Erklärung, wie man zur
              Antwort kommt. Beschreibe den Ansatz knapp statt einer langen Gedankenkette — das
              Beispiel soll die Methode zeigen, nicht das Modell zum Mitschreiben seines Denkens
              auffordern.
            </p>
            <textarea
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring"
              value={ex.thinking}
              onChange={(e) => updateExample(ex.id, { thinking: e.target.value })}
              placeholder="z. B. Fehlermeldung zeigt auf Null-Zugriff → Guard vor dem Aufruf ergänzen."
            />
          </div>
          <div>
            <label className="text-xs font-medium">Antwort</label>
            <textarea
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[40px] focus:outline-none focus:ring-2 focus:ring-ring"
              value={ex.answer}
              onChange={(e) => updateExample(ex.id, { answer: e.target.value })}
              placeholder="Erwartete Antwort..."
            />
          </div>
        </div>
      ))}

      {count === 0 && (
        <p className="text-sm text-muted-foreground py-4 text-center border border-dashed border-border rounded-lg">
          Noch keine Beispiele. Gute Beispiele sind einer der zuverlässigsten Wege, Format und Stil
          der Antwort zu steuern.
        </p>
      )}
    </div>
  );
}
