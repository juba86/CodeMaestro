"use client";

import { useState, useEffect, useCallback } from "react";
import { useBuilderStore } from "@/stores/builder-store";
import { parseXml } from "@/lib/prompt-engine/xml-parser";
import type { PromptStructured } from "@/lib/ai/types";
import { toast } from "sonner";
import { X, Search, Loader2, FileText } from "lucide-react";

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
  const [opening, setOpening] = useState<string | null>(null);

  const fetchList = useCallback(async (search: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/prompts?limit=50&q=${encodeURIComponent(search)}`);
      const d = await res.json();
      setItems(d.prompts || []);
    } catch {
      toast.error("Projekte konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    fetchList("");
  }, [open, fetchList]);

  // Debounced search.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => fetchList(q), 250);
    return () => clearTimeout(t);
  }, [q, open, fetchList]);

  if (!open) return null;

  async function handleOpen(id: string) {
    // Guard: don't silently discard an unsaved draft that was never saved.
    const isUnsavedDraft = xmlContent.trim() && !currentPromptId;
    if (isUnsavedDraft && !window.confirm("Du hast einen ungespeicherten Entwurf. Trotzdem ein anderes Projekt laden? Der Entwurf geht verloren.")) {
      return;
    }
    setOpening(id);
    try {
      const res = await fetch(`/api/prompts/${id}`);
      if (!res.ok) { toast.error("Projekt nicht gefunden."); return; }
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
      toast.success(`Projekt geladen: ${prompt.title}`);
      onClose();
    } catch {
      toast.error("Laden fehlgeschlagen.");
    } finally {
      setOpening(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="load-dialog-title"
        className="bg-background border border-border rounded-lg w-full max-w-lg max-h-[80vh] flex flex-col"
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 id="load-dialog-title" className="text-lg font-semibold">Projekt laden</h2>
          <button onClick={onClose} className="p-1 hover:bg-accent rounded" aria-label="Schließen">
            <X size={16} />
          </button>
        </div>

        <div className="p-3 border-b border-border">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              className="w-full rounded-md border border-input bg-background pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Projekte durchsuchen…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 min-h-[120px]">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
              <Loader2 size={16} className="animate-spin mr-2" /> Lädt…
            </div>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {q ? "Keine Treffer." : "Noch keine gespeicherten Projekte."}
            </p>
          ) : (
            <ul className="space-y-1">
              {items.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => handleOpen(p.id)}
                    disabled={!!opening}
                    className="w-full text-left rounded-md px-3 py-2 hover:bg-accent disabled:opacity-50 flex items-start gap-2"
                  >
                    <FileText size={15} className="mt-0.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">{p.title}</span>
                        {p.id === currentPromptId && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary shrink-0">aktuell</span>
                        )}
                      </div>
                      {p.description && (
                        <div className="text-xs text-muted-foreground truncate">{p.description}</div>
                      )}
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {new Date(p.updatedAt).toLocaleDateString()}
                        {p.tags.length > 0 && ` · ${p.tags.map((t) => t.tag).join(", ")}`}
                      </div>
                    </div>
                    {opening === p.id && <Loader2 size={14} className="animate-spin shrink-0 mt-0.5" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
