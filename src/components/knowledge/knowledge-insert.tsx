"use client";

import { useState } from "react";
import { BookOpen, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { InputGroup } from "@/components/ui/input";

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
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runSearch() {
    if (!query.trim() || searching) return;
    setSearching(true);
    setResults(null);
    setError(null);
    try {
      const res = await fetch("/api/knowledge/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, topK: 5 }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setResults(data.results || []);
      } else {
        setError(
          data.code === "EMBED_FAILED"
            ? "Ollama nicht erreichbar – die Wissensbasis ist gerade inaktiv."
            : "Suche fehlgeschlagen.",
        );
      }
    } catch {
      setError("Suche fehlgeschlagen.");
    } finally {
      setSearching(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="-my-2 -mr-2 h-10 px-2 text-xs md:-my-0 md:-mr-1.5 md:h-6">
          <BookOpen aria-hidden className="size-3.5" /> Aus Wissensbasis einfügen
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" aria-label="Aus Wissensbasis einfügen" className="w-[min(26rem,calc(100vw-1rem))] p-3">
        <form
          role="search"
          aria-label="Wissensbasis durchsuchen"
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void runSearch();
          }}
        >
          <InputGroup
            leading={<Search />}
            aria-label="Suchbegriff"
            placeholder="Relevanten Kontext suchen …"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button
            type="submit"
            variant="secondary"
            loading={searching}
            disabledReason={!query.trim() ? "Erst einen Suchbegriff eingeben" : undefined}
          >
            Suchen
          </Button>
        </form>

        <div aria-live="polite" className="mt-2">
          {error ? <p className="text-xs text-danger">{error}</p> : null}
          {results && results.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">Keine Treffer in der Wissensbasis.</p>
          ) : null}
        </div>

        {results && results.length > 0 ? (
          <ul className="mt-1 max-h-72 space-y-2 overflow-y-auto">
            {results.map((r) => (
              <li key={r.id} className="space-y-1 rounded-md border border-border bg-card p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-xs text-muted-foreground">
                    {r.docTitle} · <span className="tabular-nums">{Math.round(r.score * 100)} %</span>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="-my-1 h-10 shrink-0 px-2 text-primary-text md:my-0 md:h-6"
                    onClick={() => {
                      onInsert(r.content);
                      toast.success("Kontext eingefügt.");
                    }}
                  >
                    <Plus aria-hidden className="size-3.5" /> Einfügen
                    <span className="sr-only"> (aus {r.docTitle})</span>
                  </Button>
                </div>
                <p className="line-clamp-3 whitespace-pre-wrap text-xs text-foreground">{r.content}</p>
              </li>
            ))}
          </ul>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
