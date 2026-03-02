"use client";

import { useBuilderStore } from "@/stores/builder-store";
import { ExampleEditor } from "./example-editor";
import { buildXml } from "@/lib/prompt-engine/xml-builder";

export function CotSectionEditor() {
  const { structured, updateStructured, setXmlContent, setStep } = useBuilderStore();

  function syncXml() {
    setXmlContent(buildXml(structured));
  }

  function handleFieldChange(field: keyof typeof structured, value: string) {
    updateStructured({ [field]: value });
  }

  const sections = [
    { key: "instructions" as const, label: "Instructions", rows: 3 },
    { key: "context" as const, label: "Context", rows: 3 },
    { key: "constraints" as const, label: "Constraints", rows: 3 },
    { key: "task" as const, label: "Task", rows: 3 },
  ];

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Edit Sections</h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {sections.map(({ key, label, rows }) => (
          <div key={key}>
            <label className="text-sm font-medium">{label}</label>
            <textarea
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              rows={rows}
              value={structured[key] as string}
              onChange={(e) => handleFieldChange(key, e.target.value)}
              onBlur={syncXml}
            />
          </div>
        ))}
      </div>

      <ExampleEditor />

      <div className="flex gap-3">
        <button
          onClick={() => { syncXml(); setStep("preview"); }}
          className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
        >
          Preview XML
        </button>
        <button
          onClick={() => setStep("form")}
          className="px-4 py-2 rounded-md border border-input text-sm hover:bg-accent"
        >
          Back
        </button>
      </div>
    </div>
  );
}
