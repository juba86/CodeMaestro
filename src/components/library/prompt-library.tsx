"use client";

import { useState, useEffect, useCallback } from "react";
import { PromptCard } from "./prompt-card";
import { PromptDetail } from "./prompt-detail";
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

  const fetchPrompts = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    const res = await fetch(`/api/prompts?${params}`);
    const data = await res.json();
    setPrompts(data.prompts || []);
    setLoading(false);
  }, [search]);

  useEffect(() => {
    const timer = setTimeout(fetchPrompts, 300);
    return () => clearTimeout(timer);
  }, [fetchPrompts]);

  async function handleDelete(id: string) {
    await fetch(`/api/prompts/${id}`, { method: "DELETE" });
    setSelectedId(null);
    fetchPrompts();
  }

  if (selectedId) {
    return (
      <PromptDetail
        promptId={selectedId}
        onBack={() => setSelectedId(null)}
        onDelete={() => handleDelete(selectedId)}
        onRefresh={fetchPrompts}
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

      {loading && <p className="text-sm text-muted-foreground">Loading...</p>}

      {!loading && prompts.length === 0 && (
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
