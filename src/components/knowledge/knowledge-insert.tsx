"use client";

import { useState } from "react";
import { BookOpen, Search, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

interface SearchResult {
  id: string;
  docTitle: string;
  content: string;
  score: number;
}

/**
 * Compact knowledge-base search that lets the user pull a relevant chunk
 * straight into a target field (e.g. the prompt Context). This is the RAG
 * retrieval step applied to prompt authoring.
 */
export function KnowledgeInsert({ onInsert }: { onInsert: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);

  async function runSearch() {
    if (!query.trim()) return;
    setSearching(true);
    setResults([]);
    try {
      const res = await fetch("/api/knowledge/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, topK: 5 }),
      });
      const data = await res.json();
      if (res.ok) {
        setResults(data.results || []);
        if ((data.results || []).length === 0) toast.info("Keine Treffer in der Wissensbasis.");
      } else {
        toast.error(data.error || "Suche fehlgeschlagen.");
      }
    } finally {
      setSearching(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <BookOpen size={12} /> Aus Wissensbasis einfügen
      </button>
    );
  }

  return (
    <div className="rounded-md border border-input p-2 space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            className="w-full rounded-md border border-input bg-background pl-7 pr-2 py-1.5 text-xs"
            placeholder="Relevanten Kontext suchen…"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
          />
        </div>
        <button
          type="button"
          onClick={runSearch}
          disabled={searching || !query.trim()}
          className="px-2 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {searching ? <Loader2 size={12} className="animate-spin" /> : "Suchen"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="px-2 py-1.5 text-xs rounded-md border border-input hover:bg-accent"
        >
          ×
        </button>
      </div>

      {results.length > 0 && (
        <ul className="space-y-1.5 max-h-60 overflow-y-auto">
          {results.map((r) => (
            <li key={r.id} className="rounded border border-border p-2 text-xs space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground truncate">
                  {r.docTitle} · {(r.score * 100).toFixed(0)}%
                </span>
                <button
                  type="button"
                  onClick={() => { onInsert(r.content); toast.success("Kontext eingefügt."); }}
                  className="flex items-center gap-1 text-primary hover:underline shrink-0"
                >
                  <Plus size={11} /> Einfügen
                </button>
              </div>
              <p className="line-clamp-3 whitespace-pre-wrap">{r.content}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
