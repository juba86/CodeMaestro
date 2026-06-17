"use client";

import { useState, useRef, useEffect } from "react";
import { useBuilderStore } from "@/stores/builder-store";
import { toast } from "sonner";
import { X } from "lucide-react";

interface SavePromptDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SavePromptDialog({ open, onClose }: SavePromptDialogProps) {
  const { xmlContent, structured, currentPromptId, setCurrentPromptId, projectMeta, setProjectMeta } = useBuilderStore();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      // Prefill from the loaded project's metadata so an "Update" doesn't force
      // the user to retype the title/description/tags.
      if (currentPromptId && projectMeta) {
        setTitle(projectMeta.title);
        setDescription(projectMeta.description);
        setTagsInput(projectMeta.tags.join(", "));
      }
      // Auto-focus title input when dialog opens
      setTimeout(() => titleRef.current?.focus(), 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  async function handleSave() {
    if (!title.trim()) {
      toast.error("Title is required.");
      return;
    }
    setSaving(true);
    try {
      const tags = tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const meta = { title, description, tags };

      if (currentPromptId) {
        // Update existing
        await fetch(`/api/prompts/${currentPromptId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            description,
            content: xmlContent,
            structured: JSON.stringify(structured),
            tags,
            changelog: `Updated: ${title}`,
          }),
        });
        setProjectMeta(meta);
        toast.success("Prompt updated!");
      } else {
        // Create new
        const res = await fetch("/api/prompts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            description,
            content: xmlContent,
            structured: JSON.stringify(structured),
            tags,
          }),
        });
        const data = await res.json();
        setCurrentPromptId(data.prompt.id);
        setProjectMeta(meta);
        toast.success("Prompt saved!");
      }
      onClose();
    } catch {
      toast.error("Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-dialog-title"
        className="bg-background border border-border rounded-lg p-6 w-full max-w-md space-y-4"
      >
        <div className="flex items-center justify-between">
          <h2 id="save-dialog-title" className="text-lg font-semibold">
            {currentPromptId ? "Update Prompt" : "Save Prompt"}
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-accent rounded" aria-label="Close dialog">
            <X size={16} />
          </button>
        </div>

        <div>
          <label className="text-sm font-medium">Title *</label>
          <input
            ref={titleRef}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="My CoT Prompt"
          />
        </div>

        <div>
          <label className="text-sm font-medium">Description</label>
          <textarea
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] focus:outline-none focus:ring-2 focus:ring-ring"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this prompt do?"
          />
        </div>

        <div>
          <label className="text-sm font-medium">Tags (comma-separated)</label>
          <input
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="code-review, security, python"
          />
        </div>

        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-md border border-input hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
