"use client";

import { useBuilderStore } from "@/stores/builder-store";
import { useSettingsStore } from "@/stores/settings-store";
import { buildXml } from "@/lib/prompt-engine/xml-builder";
import { generateCoTPrompt } from "@/lib/prompt-engine/cot-generator";
import { decryptApiKey } from "@/lib/ai/crypto";
import { SwarmConfigPanel } from "./swarm-config-panel";
import { TechniqueRecommender } from "./technique-recommender";
import { toast } from "sonner";

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
      let apiKey: string | undefined;
      const enc = localStorage.getItem(`pb-apikey-${activeProvider}`);
      if (enc) {
        try { apiKey = await decryptApiKey(enc); } catch { /* ignore */ }
      }
      const result = await generateCoTPrompt(structured, activeProvider, activeModel, apiKey);
      if (result) {
        updateStructured(result);
        setXmlContent(buildXml(result));
        setStep("edit");
        toast.success("CoT prompt generated!");
      }
    } catch (err) {
      toast.error("Generation failed. Check your API key in Settings.");
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
            <label className="text-sm font-medium">Context</label>
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
