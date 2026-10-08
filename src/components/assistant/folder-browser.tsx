"use client";

import * as React from "react";
import { ChevronUp, Folder, FolderGit2, FolderPlus } from "lucide-react";
import { toast } from "sonner";
import { Button, IconButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { folderName, shortPath } from "./session-list";
import type { BrowseState } from "./types";

/** Folder navigation inside the allowed roots (GET /api/assistant/browse). */
export function useBrowse(onPath: (path: string) => void) {
  const [browse, setBrowse] = React.useState<BrowseState | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const pathRef = React.useRef(onPath);
  React.useEffect(() => {
    pathRef.current = onPath;
  }, [onPath]);

  // Only the latest navigation counts (fast clicks must not end in an older folder).
  const seq = React.useRef(0);
  const load = React.useCallback(async (path?: string) => {
    const mine = ++seq.current;
    const url = path ? `/api/assistant/browse?path=${encodeURIComponent(path)}` : "/api/assistant/browse";
    const d = (await fetch(url, { cache: "no-store" })
      .then((r) => r.json())
      .catch(() => null)) as (BrowseState & { error?: string }) | null;
    if (mine !== seq.current) return false;
    if (d?.path) {
      setBrowse({ path: d.path, parent: d.parent ?? null, dirs: d.dirs || [] });
      setError(null);
      pathRef.current(d.path);
      return true;
    }
    setError(d?.error ? "Ordner nicht verfügbar." : "Ordner konnten nicht geladen werden.");
    return false;
  }, []);

  return { browse, error, load };
}

export function FolderBrowser({
  browse,
  error,
  onNavigate,
}: {
  browse: BrowseState | null;
  error: string | null;
  onNavigate: (path?: string) => Promise<boolean>;
}) {
  const [name, setName] = React.useState("");
  const [creating, setCreating] = React.useState(false);

  async function createFolder() {
    if (!name.trim() || !browse) return;
    setCreating(true);
    try {
      const res = await fetch("/api/assistant/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), parent: browse.path }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.error || "Ordner konnte nicht erstellt werden.");
        return;
      }
      setName("");
      await onNavigate(d.path); // navigate into the new folder (becomes the cwd)
      toast.success("Ordner erstellt.");
    } catch {
      toast.error("Server nicht erreichbar.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-lg border border-input">
        <div className="flex min-h-10 items-center gap-1.5 border-b border-border bg-surface-2 px-1.5 md:min-h-9">
          <IconButton
            aria-label="Übergeordneter Ordner"
            size="icon"
            className="md:size-7"
            disabled={!browse?.parent}
            onClick={() => browse?.parent && void onNavigate(browse.parent)}
          >
            <ChevronUp />
          </IconButton>
          <FolderGit2 aria-hidden className="size-4 shrink-0 text-subtle-foreground" />
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={browse?.path}>
            {browse ? shortPath(browse.path) : "…"}
          </span>
        </div>
        <div className="max-h-52 overflow-y-auto p-1">
          {!browse && !error ? (
            <div className="space-y-1 p-1">
              <Skeleton className="h-7 w-2/3" />
              <Skeleton className="h-7 w-1/2" />
            </div>
          ) : null}
          {error ? <p className="px-2 py-1.5 text-ui text-danger">{error}</p> : null}
          {browse && browse.dirs.length === 0 ? <p className="px-2 py-1.5 text-ui text-muted-foreground">Keine Unterordner</p> : null}
          {browse?.dirs.length ? (
            <ul aria-label="Unterordner">
              {browse.dirs.map((dir) => (
                <li key={dir.path}>
                  <button
                    type="button"
                    onClick={() => void onNavigate(dir.path)}
                    className="flex min-h-10 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring md:min-h-8 md:text-ui"
                  >
                    <Folder aria-hidden className="size-4 shrink-0 text-subtle-foreground" />
                    <span className="truncate">{dir.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
      <p className="text-ui text-muted-foreground" aria-live="polite">
        Session startet in: <span className="font-medium text-foreground">{browse ? folderName(browse.path) : "—"}</span>
      </p>
      <div className="flex gap-2">
        <Input
          aria-label="Name des neuen Ordners"
          placeholder="Neuer Ordner (hier anlegen)"
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void createFolder();
            }
          }}
        />
        <Button variant="outline" onClick={() => void createFolder()} loading={creating} disabledReason={!name.trim() ? "Erst einen Namen eingeben." : undefined}>
          <FolderPlus aria-hidden />
          Anlegen
        </Button>
      </div>
    </div>
  );
}
