"use client";

import { useEffect, useState } from "react";
import { FolderGit2, Lock, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { InputGroup } from "@/components/ui/input";
import { SegmentedControl, SegmentedItem } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { repoContextBlock, type GithubRepoBrief, type GithubRepoInfo, type GithubRepoMode } from "@/lib/github-repo-context";

/**
 * Picks one of the connected GitHub account's repositories and inserts it into
 * a prompt field as context — either as the repository to work in or as a
 * read-only reference.
 */
export function GithubRepoInsert({ onInsert }: { onInsert: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<GithubRepoMode>("edit");
  const [query, setQuery] = useState("");
  const [repos, setRepos] = useState<GithubRepoInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inserting, setInserting] = useState<string | null>(null);

  // Load the list the first time the popover opens (and again after an error).
  const needed = open && repos === null && error === null;
  useEffect(() => {
    if (!needed) return;
    let cancelled = false;
    fetch("/api/github/repos", { cache: "no-store" })
      .then(async (res) => {
        const d = (await res.json().catch(() => null)) as { repos?: GithubRepoInfo[]; error?: string; code?: string } | null;
        if (cancelled) return;
        if (res.ok && d?.repos) setRepos(d.repos);
        else setError(d?.code === "NOT_CONNECTED" ? "Kein GitHub-Konto verbunden – in den Einstellungen unter GitHub verbinden." : d?.error || "Repositories konnten nicht geladen werden.");
      })
      .catch(() => { if (!cancelled) setError("Server nicht erreichbar."); });
    return () => { cancelled = true; };
  }, [needed]);

  async function insert(fullName: string) {
    setInserting(fullName);
    try {
      const res = await fetch(`/api/github/repos/brief?repo=${encodeURIComponent(fullName)}`, { cache: "no-store" });
      const d = (await res.json().catch(() => null)) as { repo?: GithubRepoBrief; error?: string } | null;
      if (!res.ok || !d?.repo) throw new Error(d?.error || "Repository konnte nicht gelesen werden.");
      onInsert(repoContextBlock(d.repo, mode));
      toast.success(mode === "edit" ? `Repository eingefügt: ${fullName}` : `Als Referenz eingefügt: ${fullName}`);
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Repository konnte nicht gelesen werden.");
    } finally {
      setInserting(null);
    }
  }

  const q = query.trim().toLowerCase();
  const shown = (repos ?? []).filter((r) => !q || r.fullName.toLowerCase().includes(q) || r.description.toLowerCase().includes(q));

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o && error) setError(null); // retry
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="-my-2 h-10 px-2 text-xs md:-my-0 md:h-6">
          <FolderGit2 aria-hidden className="size-3.5" /> GitHub-Repository
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" aria-label="GitHub-Repository einfügen" className="w-[min(26rem,calc(100vw-1rem))] space-y-2 p-3">
        <SegmentedControl value={mode} onValueChange={(v) => setMode(v as GithubRepoMode)} size="sm" stretch aria-label="Verwendung">
          <SegmentedItem value="edit">Bearbeiten</SegmentedItem>
          <SegmentedItem value="reference">Als Referenz</SegmentedItem>
        </SegmentedControl>
        <p className="text-xs text-muted-foreground">
          {mode === "edit"
            ? "Der Agent arbeitet in diesem Repository."
            : "Der Agent liest das Repository nur und ändert dort nichts."}
        </p>
        <InputGroup
          leading={<Search />}
          type="search"
          aria-label="Repositories filtern"
          placeholder="Repository suchen …"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div aria-live="polite">
          {error ? <p className="py-2 text-xs text-danger">{error}</p> : null}
          {repos && shown.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">{q ? "Keine Treffer." : "Keine Repositories gefunden."}</p>
          ) : null}
        </div>
        {!repos && !error ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-4/5" />
          </div>
        ) : null}
        {shown.length > 0 ? (
          <ul className="max-h-72 space-y-1.5 overflow-y-auto">
            {shown.map((r) => (
              <li key={r.fullName} className="flex items-center justify-between gap-2 rounded-md border border-border bg-card p-2">
                <span className="min-w-0">
                  <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-foreground">
                    {r.private ? <Lock aria-label="privat" className="size-3 shrink-0 text-subtle-foreground" /> : null}
                    <span className="truncate">{r.fullName}</span>
                  </span>
                  {r.description || r.language ? (
                    <span className="block truncate text-xs text-muted-foreground">{[r.language, r.description].filter(Boolean).join(" · ")}</span>
                  ) : null}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="-my-1 h-10 shrink-0 px-2 text-primary-text md:my-0 md:h-6"
                  loading={inserting === r.fullName}
                  disabled={inserting !== null}
                  onClick={() => void insert(r.fullName)}
                >
                  {inserting === r.fullName ? null : <Plus aria-hidden className="size-3.5" />} Einfügen
                  <span className="sr-only"> ({r.fullName})</span>
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
