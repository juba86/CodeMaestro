"use client";

import { useState } from "react";
import { useBuilderStore } from "@/stores/builder-store";
import { ProjectInfoForm } from "./project-info-form";
import { CotSectionEditor } from "./cot-section-editor";
import { PromptPreview } from "./prompt-preview";
import { RefinementChat } from "./refinement-chat";
import { SavePromptDialog } from "./save-prompt-dialog";
import { LoadProjectDialog } from "./load-project-dialog";
import { cn } from "@/lib/utils";
import { Save, RotateCcw, FolderOpen, Pencil } from "lucide-react";

const steps = [
  { id: "form" as const, label: "Project Info" },
  { id: "edit" as const, label: "Edit Sections" },
  { id: "preview" as const, label: "Preview" },
  { id: "refine" as const, label: "Refine" },
];

export function BuilderWorkflow() {
  const { step, setStep, reset, xmlContent, currentPromptId, projectMeta } = useBuilderStore();
  const [saveOpen, setSaveOpen] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);

  function handleReset() {
    if (!window.confirm("Reset all progress? This will clear your current prompt and chat history.")) {
      return;
    }
    reset();
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {steps.map((s, i) => (
            <div key={s.id} className="flex items-center">
              <button
                onClick={() => setStep(s.id)}
                className={cn(
                  "px-3 py-1.5 text-sm rounded-md transition-colors",
                  step === s.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                )}
              >
                {i + 1}. {s.label}
              </button>
              {i < steps.length - 1 && (
                <span className="mx-1 text-muted-foreground">/</span>
              )}
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setLoadOpen(true)}
            className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-md border border-input hover:bg-accent"
            title="Ein gespeichertes Projekt laden und bearbeiten"
          >
            <FolderOpen size={14} /> Load
          </button>
          {xmlContent && (
            <button
              onClick={() => setSaveOpen(true)}
              className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Save size={14} /> {currentPromptId ? "Update" : "Save"}
            </button>
          )}
          <button
            onClick={handleReset}
            className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-md border border-input hover:bg-accent text-muted-foreground"
          >
            <RotateCcw size={14} /> Reset
          </button>
        </div>
      </div>

      {currentPromptId && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground -mt-2">
          <Pencil size={12} className="text-primary" />
          Bearbeite gespeichertes Projekt:
          <span className="font-medium text-foreground">{projectMeta?.title || "(unbenannt)"}</span>
          <span className="text-muted-foreground">— „Update" speichert Änderungen zurück.</span>
        </div>
      )}

      {step === "form" && <ProjectInfoForm />}
      {step === "edit" && <CotSectionEditor />}
      {step === "preview" && <PromptPreview />}
      {step === "refine" && <RefinementChat />}

      <SavePromptDialog open={saveOpen} onClose={() => setSaveOpen(false)} />
      <LoadProjectDialog open={loadOpen} onClose={() => setLoadOpen(false)} />
    </div>
  );
}
