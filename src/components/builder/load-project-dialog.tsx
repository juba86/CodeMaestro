"use client";

import { useState, useEffect, useCallback } from "react";
import { FileText, Search } from "lucide-react";
import { toast } from "sonner";
import { useBuilderStore } from "@/stores/builder-store";
import { parseXml } from "@/lib/prompt-engine/xml-parser";
import type { PromptStructured } from "@/lib/ai/types";
import { formatRelative } from "@/lib/format";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InputGroup } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { confirm } from "@/components/ui/confirm";
import { cn } from "@/components/ui/cn";
import { markXmlInSync } from "./draft-sync";

interface LoadProjectDialogProps {
  open: boolean;
  onClose: () => void;
}

interface PromptListItem {
  id: string;
  title: string;
  description: string;
  updatedAt: string;
  tags: { id: string; tag: string }[];
  _count?: { versions: number };
}

export function LoadProjectDialog({ open, onClose }: LoadProjectDialogProps) {
  const { loadProject, xmlContent, currentPromptId } = useBuilderStore();
  const [items, setItems] = useState<PromptListItem[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);

  const fetchList = useCallback(async (search: string) => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/prompts?limit=50&q=${encodeURIComponent(search)}`);
      if (!res.ok) throw new Error(String(res.status));
      const d = await res.json();
      setItems(d.prompts || []);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load on open, debounced while typing.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => fetchList(q), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [q, open, fetchList]);

  async function handleOpen(id: string) {
    // Guard: don't silently discard a draft that was never saved.
    const isUnsavedDraft = xmlContent.trim() && !currentPromptId;
    if (
      isUnsavedDraft &&
      !(await confirm({
        title: "Entwurf verwerfen?",
        description: "Du hast einen ungespeicherten Entwurf. Wenn du ein anderes Projekt lädst, geht er verloren.",
        confirmLabel: "Verwerfen",
        tone: "danger",
      }))
    ) {
      return;
    }
    setOpening(id);
    try {
      const res = await fetch(`/api/prompts/${id}`);
      if (!res.ok) {
        toast.error("Projekt nicht gefunden.");
        return;
      }
      const { prompt } = await res.json();

      // Prefer the persisted structured JSON; fall back to parsing the XML.
      let structured: PromptStructured;
      try {
        const parsed = JSON.parse(prompt.structured || "{}");
        structured = parsed && Object.keys(parsed).length > 0 ? parsed : parseXml(prompt.content);
      } catch {
        structured = parseXml(prompt.content);
      }

      loadProject({
        id: prompt.id,
        title: prompt.title,
        description: prompt.description,
        tags: (prompt.tags || []).map((t: { tag: string }) => t.tag),
        content: prompt.content,
        structured,
      });
      markXmlInSync();
      toast.success(`Projekt geladen: ${prompt.title}`);
      onClose();
    } catch {
      toast.error("Laden fehlgeschlagen.");
    } finally {
      setOpening(null);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Projekt laden</DialogTitle>
          <DialogDescription>Einen gespeicherten Prompt aus der Bibliothek im Builder weiterbearbeiten.</DialogDescription>
        </DialogHeader>
        <div className="px-5 pb-2 pt-1">
          <InputGroup
            leading={<Search />}
            type="search"
            aria-label="Projekte durchsuchen"
            placeholder="Projekte durchsuchen …"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <DialogBody className="min-h-40 px-3 pb-4">
          <div aria-live="polite" className="sr-only">
            {loading ? "Lädt …" : failed ? "" : `${items.length} ${items.length === 1 ? "Projekt" : "Projekte"}`}
          </div>
          {loading && items.length === 0 ? (
            <div className="space-y-2 px-2 py-1">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-4/5" />
            </div>
          ) : failed ? (
            <p className="px-2 py-8 text-center text-ui text-danger">Projekte konnten nicht geladen werden.</p>
          ) : items.length === 0 ? (
            <p className="px-2 py-8 text-center text-ui text-muted-foreground">
              {q ? "Keine Treffer." : "Noch keine Prompts gespeichert."}
            </p>
          ) : (
            <ul className={cn("space-y-0.5", loading && "opacity-60")}>
              {items.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => void handleOpen(p.id)}
                    disabled={!!opening}
                    className="flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
                  >
                    <FileText aria-hidden className="mt-0.5 size-4 shrink-0 text-subtle-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium md:text-ui">{p.title}</span>
                        {p.id === currentPromptId ? <Badge variant="brand">geöffnet</Badge> : null}
                      </span>
                      {p.description ? (
                        <span className="block truncate text-xs text-muted-foreground">{p.description}</span>
                      ) : null}
                      <span className="mt-0.5 block text-xs text-subtle-foreground">
                        {formatRelative(p.updatedAt)}
                        {p.tags.length > 0 && ` · ${p.tags.map((t) => t.tag).join(", ")}`}
                      </span>
                    </span>
                    {opening === p.id ? <Spinner aria-label="Wird geladen" className="mt-0.5" /> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
