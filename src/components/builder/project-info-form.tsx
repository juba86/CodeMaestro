"use client";

import { useBuilderStore } from "@/stores/builder-store";
import { useSettingsStore } from "@/stores/settings-store";
import { buildXml } from "@/lib/prompt-engine/xml-builder";
import { generateCoTPrompt } from "@/lib/prompt-engine/cot-generator";
import { getApiKey } from "@/lib/ai/client-keys";
import { SwarmConfigPanel } from "./swarm-config-panel";
import { TechniqueRecommender } from "./technique-recommender";
import { KnowledgeInsert } from "@/components/knowledge/knowledge-insert";
import type { PromptStructured } from "@/lib/ai/types";
import { toast } from "sonner";

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

export function ProjectInfoForm() {
  const { structured, updateStructured, setXmlContent, setStep, setIsGenerating, isGenerating } =
    useBuilderStore();
  const { activeProvider, activeModel } = useSettingsStore();

  async function handleGenerate() {
    if (!structured.instructions.trim()) {
      toast.error("Please enter at least the instructions/goal.");
      return;
    }
    setIsGenerating(true);
    try {
      const apiKey = await getApiKey(activeProvider);
      const result = await generateCoTPrompt(structured, activeProvider, activeModel, apiKey);
      if (!result || !hasPromptContent(result)) {
        toast.error("The AI reply contained no usable prompt XML. Try again or another model.");
      } else {
        // Merge into the latest draft (the form stays editable while generating).
        const merged = mergeGenerated(useBuilderStore.getState().structured, result);
        updateStructured(merged);
        setXmlContent(buildXml(merged));
        setStep("edit");
        toast.success("Prompt erstellt.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed. Check your API key in Settings.");
      console.error(err);
    } finally {
      setIsGenerating(false);
    }
  }

  function handleManual() {
    setXmlContent(buildXml(structured));
    setStep("edit");
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-4">
        <h2 className="text-xl font-semibold">Project Information</h2>

        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium">Instructions / Goal *</label>
            <textarea
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px] focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="What should the AI do? e.g., 'Review code for security vulnerabilities and suggest fixes'"
              value={structured.instructions}
              onChange={(e) => updateStructured({ instructions: e.target.value })}
            />
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Context</label>
              <KnowledgeInsert
                onInsert={(text) =>
                  updateStructured({
                    context: structured.context ? `${structured.context}\n\n${text}` : text,
                  })
                }
              />
            </div>
            <textarea
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Background info, tech stack, project details..."
              value={structured.context}
              onChange={(e) => updateStructured({ context: e.target.value })}
            />
          </div>

          <div>
            <label className="text-sm font-medium">Constraints</label>
            <textarea
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Rules, limitations, things to avoid..."
              value={structured.constraints}
              onChange={(e) => updateStructured({ constraints: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Target Audience</label>
              <input
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="e.g., Senior developers"
                value={structured.targetAudience}
                onChange={(e) => updateStructured({ targetAudience: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Output Format</label>
              <input
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="e.g., Markdown, JSON, XML"
                value={structured.outputFormat}
                onChange={(e) => updateStructured({ outputFormat: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Task Description</label>
            <textarea
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="The specific task to execute..."
              value={structured.task}
              onChange={(e) => updateStructured({ task: e.target.value })}
            />
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {isGenerating ? "Generating..." : "Generate with AI"}
          </button>
          <button
            onClick={handleManual}
            className="px-4 py-2 rounded-md border border-input text-sm hover:bg-accent"
          >
            Build Manually
          </button>
        </div>
      </div>

      <div className="space-y-6">
        <TechniqueRecommender />
        <SwarmConfigPanel />
      </div>
    </div>
  );
}
