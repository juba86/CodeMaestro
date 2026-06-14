"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, Search, Loader2, Copy, FileText } from "lucide-react";
import { toast } from "sonner";

interface KnowledgeDoc {
  id: string;
  title: string;
  source: string;
  createdAt: string;
  chunkCount: number;
}

interface SearchResult {
  id: string;
  docId: string;
  docTitle: string;
  content: string;
  score: number;
}

export function KnowledgeView() {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ title: "", source: "manual", content: "" });
  const [saving, setSaving] = useState(false);

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);

  const load = useCallback(() => {
    fetch("/api/knowledge")
      .then((r) => r.json())
      .then((d) => setDocs(d.docs || []))
      .catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addDoc() {
    if (!draft.title.trim() || !draft.content.trim()) {
      toast.error("Titel und Inhalt erforderlich.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Indexiert: ${data.doc.chunkCount} Chunks.`);
        setDraft({ title: "", source: "manual", content: "" });
        setAdding(false);
        load();
      } else {
        toast.error(data.error || "Indexierung fehlgeschlagen.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function deleteDoc(id: string) {
    if (!window.confirm("Dokument löschen?")) return;
    await fetch(`/api/knowledge/${id}`, { method: "DELETE" });
    load();
  }

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
        if ((data.results || []).length === 0) toast.info("Keine Treffer.");
      } else {
        toast.error(data.error || "Suche fehlgeschlagen.");
      }
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Wissensbasis (RAG)</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Lokale Vektor-Suche über deine Dokumente — Embeddings via Ollama (bge-m3), nichts verlässt den Server.
          </p>
        </div>
        <button
          onClick={() => setAdding((v) => !v)}
          className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus size={14} /> Dokument
        </button>
      </div>

      {adding && (
        <div className="space-y-2 rounded-lg border border-border p-4">
          <input
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder="Titel"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
          <input
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder="Quelle (optional, z.B. URL/Datei)"
            value={draft.source}
            onChange={(e) => setDraft({ ...draft, source: e.target.value })}
          />
          <textarea
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[160px] font-mono"
            placeholder="Text einfügen — wird automatisch in Chunks zerlegt und eingebettet…"
            value={draft.content}
            onChange={(e) => setDraft({ ...draft, content: e.target.value })}
          />
          <div className="flex gap-2">
            <button
              onClick={addDoc}
              disabled={saving}
              className="flex items-center gap-1 px-3 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Indexieren
            </button>
            <button onClick={() => setAdding(false)} className="px-3 py-2 text-sm rounded-md border border-input hover:bg-accent">
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              className="w-full rounded-md border border-input bg-background pl-9 pr-3 py-2 text-sm"
              placeholder="Wissensbasis durchsuchen…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch()}
            />
          </div>
          <button
            onClick={runSearch}
            disabled={searching || !query.trim()}
            className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1"
          >
            {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            Suchen
          </button>
        </div>

        {results.length > 0 && (
          <ul className="space-y-2">
            {results.map((r) => (
              <li key={r.id} className="rounded-md border border-border p-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                    <FileText size={12} /> {r.docTitle} · {(r.score * 100).toFixed(0)}% Match
                  </span>
                  <button
                    onClick={() => { navigator.clipboard.writeText(r.content); toast.success("Kopiert."); }}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Chunk kopieren"
                  >
                    <Copy size={13} />
                  </button>
                </div>
                <p className="text-sm whitespace-pre-wrap">{r.content}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Doc list */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Dokumente ({docs.length})</h3>
        {docs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch keine Dokumente indexiert.</p>
        ) : (
          <ul className="space-y-1.5">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{d.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {d.chunkCount} Chunks · {d.source || "manual"} · {new Date(d.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <button onClick={() => deleteDoc(d.id)} aria-label="Dokument löschen" className="text-muted-foreground hover:text-destructive shrink-0">
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
