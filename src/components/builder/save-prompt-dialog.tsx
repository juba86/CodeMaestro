"use client";

import { useState } from "react";
import { useBuilderStore } from "@/stores/builder-store";
import { toast } from "sonner";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldHint, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const e = await res.json().catch(() => null);
  return typeof e?.error === "string" ? `${fallback}: ${e.error}` : `${fallback} (HTTP ${res.status}).`;
}

// Tags as the server stored them (it trims and de-duplicates), falling back to
// what was sent.
function savedTags(data: { prompt?: { tags?: { tag: string }[] } }, sent: string[]): string[] {
  const stored = data.prompt?.tags;
  return Array.isArray(stored) ? stored.map((t) => t.tag) : sent;
}

interface SavePromptDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SavePromptDialog({ open, onClose }: SavePromptDialogProps) {
  // A fresh form per opening, prefilled from the project loaded at that time;
  // the dialog itself stays mounted so it can animate out.
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSession((n) => n + 1);
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <SaveForm key={session} onClose={onClose} />
    </Dialog>
  );
}

function SaveForm({ onClose }: { onClose: () => void }) {
  const { xmlContent, structured, currentPromptId, setCurrentPromptId, projectMeta, setProjectMeta } = useBuilderStore();
  // Prefill from the loaded project's metadata so saving a new version doesn't
  // force the user to retype the title/description/tags.
  const prefill = currentPromptId && projectMeta ? projectMeta : null;
  const [title, setTitle] = useState(prefill?.title ?? "");
  const [description, setDescription] = useState(prefill?.description ?? "");
  const [tagsInput, setTagsInput] = useState(prefill?.tags.join(", ") ?? "");
  const [saving, setSaving] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);

  async function handleSave() {
    if (!title.trim()) {
      setTitleError("Titel fehlt.");
      document.getElementById("pb-save-title")?.focus();
      return;
    }
    setSaving(true);
    try {
      const tags = tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const body = {
        title,
        description,
        content: xmlContent,
        structured: JSON.stringify(structured),
        tags,
      };

      if (currentPromptId) {
        // Update existing (the server adds a version).
        const res = await fetch(`/api/prompts/${currentPromptId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, changelog: `Aktualisiert: ${title.trim()}` }),
        });
        if (res.status === 404) {
          // Deleted elsewhere: detach so the next save creates a new prompt.
          setCurrentPromptId(null);
          setProjectMeta(null);
          throw new Error("Dieser Prompt existiert nicht mehr in der Bibliothek. Speichere erneut, um ihn neu anzulegen.");
        }
        if (!res.ok) throw new Error(await errorMessage(res, "Aktualisieren fehlgeschlagen"));
        const data = await res.json();
        setProjectMeta({ title, description, tags: savedTags(data, tags) });
        toast.success("Gespeichert – neue Version angelegt.");
      } else {
        const res = await fetch("/api/prompts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(await errorMessage(res, "Speichern fehlgeschlagen"));
        const data = await res.json();
        setCurrentPromptId(data.prompt.id);
        setProjectMeta({ title, description, tags: savedTags(data, tags) });
        toast.success("Gespeichert");
      }
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogContent
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        document.getElementById("pb-save-title")?.focus();
      }}
    >
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSave();
        }}
      >
        <DialogHeader>
          <DialogTitle>{currentPromptId ? "Neue Version speichern" : "In Bibliothek speichern"}</DialogTitle>
          <DialogDescription>
            {currentPromptId
              ? "Aktualisiert den gespeicherten Prompt; die bisherige Fassung bleibt als Version erhalten."
              : "Legt den Prompt in der Bibliothek ab – mit Versionen und Testfällen."}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4 pb-1">
          <Field id="pb-save-title" required invalid={!!titleError}>
            <FieldLabel>Titel</FieldLabel>
            <Input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (titleError) setTitleError(null);
              }}
              placeholder="z. B. Code-Review für Pull Requests"
            />
            <FieldError>{titleError}</FieldError>
          </Field>
          <Field>
            <FieldLabel optional="optional">Beschreibung</FieldLabel>
            <Textarea
              autosize={{ min: 2, max: 6 }}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Wofür ist dieser Prompt gedacht?"
            />
          </Field>
          <Field>
            <FieldLabel optional="optional">Tags</FieldLabel>
            <Input
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="code-review, sicherheit, python"
            />
            <FieldHint>Mit Komma trennen.</FieldHint>
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" variant="primary" loading={saving}>
            Speichern
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
