"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { PromptCard } from "./prompt-card";
import { PromptDetail } from "./prompt-detail";
import { useBuilderStore } from "@/stores/builder-store";
import { toast } from "sonner";
import { Search, Plus } from "lucide-react";
import Link from "next/link";

interface PromptSummary {
  id: string;
  title: string;
  description: string;
  content: string;
  updatedAt: string;
  tags: { id: string; tag: string }[];
  _count: { versions: number; testResults: number };
}

export function PromptLibrary() {
  const [prompts, setPrompts] = useState<PromptSummary[]>([]);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchPrompts = useCallback(async () => {
    // Cancel previous in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      const res = await fetch(`/api/prompts?${params}`, { signal: controller.signal });
      if (!res.ok) throw new Error("Failed to load prompts");
      const data = await res.json();
      setPrompts(data.prompts || []);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError("Failed to load prompts. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const timer = setTimeout(fetchPrompts, 300);
    return () => {
      clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [fetchPrompts]);

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this prompt? This action cannot be undone.")) return;
    try {
      const res = await fetch(`/api/prompts/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        const e = await res.json().catch(() => ({}));
        toast.error(e.error || `Delete failed (HTTP ${res.status}).`);
        return;
      }
      // If the builder still has this prompt loaded, detach it so a later save
      // creates a new prompt instead of updating one that no longer exists.
      const builder = useBuilderStore.getState();
      if (builder.currentPromptId === id) {
        builder.setCurrentPromptId(null);
        builder.setProjectMeta(null);
      }
      setSelectedId(null);
      fetchPrompts();
    } catch {
      toast.error("Failed to delete prompt.");
    }
  }

  if (selectedId) {
    return (
      <PromptDetail
        promptId={selectedId}
        onBack={() => setSelectedId(null)}
        onDelete={() => handleDelete(selectedId)}
      />
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Prompt Library</h1>
        <Link
          href="/builder"
          className="flex items-center gap-1 px-3 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus size={16} /> New Prompt
        </Link>
      </div>

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          className="w-full pl-9 pr-4 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder="Search prompts by title, description, or content..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {error && (
        <div className="text-sm text-destructive bg-destructive/10 rounded-md px-4 py-2">
          {error}
        </div>
      )}

      {loading && <p className="text-sm text-muted-foreground">Loading...</p>}

      {!loading && !error && prompts.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-lg">No prompts yet</p>
          <p className="text-sm mt-1">Create your first prompt in the Builder.</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {prompts.map((p) => (
          <PromptCard key={p.id} prompt={p} onClick={() => setSelectedId(p.id)} />
        ))}
      </div>
    </div>
  );
}
