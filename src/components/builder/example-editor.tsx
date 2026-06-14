"use client";

import { useBuilderStore } from "@/stores/builder-store";
import { uid } from "@/lib/uid";
import { Plus, Trash2 } from "lucide-react";

export function ExampleEditor() {
  const { structured, addExample, updateExample, removeExample } = useBuilderStore();

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
        <h3 className="text-sm font-semibold">
          Chain-of-Thought Examples ({structured.examples.length})
        </h3>
        <button
          onClick={handleAdd}
          className="text-sm flex items-center gap-1 px-2 py-1 rounded hover:bg-accent"
        >
          <Plus size={14} /> Add Example
        </button>
      </div>

      {structured.examples.map((ex, idx) => (
        <div key={ex.id} className="border border-border rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Example {idx + 1}</span>
            <button
              onClick={() => removeExample(ex.id)}
              className="p-1 text-muted-foreground hover:text-destructive"
            >
              <Trash2 size={14} />
            </button>
          </div>
          <div>
            <label className="text-xs font-medium">Input</label>
            <textarea
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[40px] focus:outline-none focus:ring-2 focus:ring-ring"
              value={ex.input}
              onChange={(e) => updateExample(ex.id, { input: e.target.value })}
              placeholder="Example input..."
            />
          </div>
          <div>
            <label className="text-xs font-medium">Thinking (Chain-of-Thought Steps)</label>
            <textarea
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring"
              value={ex.thinking}
              onChange={(e) => updateExample(ex.id, { thinking: e.target.value })}
              placeholder="Step 1: Analyze...&#10;Step 2: Consider...&#10;Step 3: Conclude..."
            />
          </div>
          <div>
            <label className="text-xs font-medium">Answer</label>
            <textarea
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[40px] focus:outline-none focus:ring-2 focus:ring-ring"
              value={ex.answer}
              onChange={(e) => updateExample(ex.id, { answer: e.target.value })}
              placeholder="Expected answer..."
            />
          </div>
        </div>
      ))}

      {structured.examples.length === 0 && (
        <p className="text-sm text-muted-foreground py-4 text-center border border-dashed border-border rounded-lg">
          No examples yet. Add examples to improve Chain-of-Thought quality.
        </p>
      )}
    </div>
  );
}
