"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FileUp, Hammer, LayoutTemplate, Library, RotateCw, Search, SearchX } from "lucide-react";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-media-query";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { InputGroup } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ui/select";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { Callout } from "@/components/ui/callout";
import { Skeleton } from "@/components/ui/skeleton";
import { PromptCard, type PromptSummary } from "./prompt-card";
import { PromptDetail } from "./prompt-detail";

const PAGE_SIZE = 50;

type Sort = "updated" | "created" | "title";
const SORT_OPTIONS: { value: Sort; label: string }[] = [
  { value: "updated", label: "Zuletzt geändert" },
  { value: "created", label: "Zuletzt angelegt" },
  { value: "title", label: "Titel A–Z" },
];

/** Most used tags first (ties alphabetically). */
function tagsByUse(prompts: PromptSummary[]): string[] {
  const n = new Map<string, number>();
  for (const p of prompts) for (const t of p.tags) n.set(t.tag, (n.get(t.tag) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "de")).map(([t]) => t);
}

export function PromptLibrary() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("prompt");
  const isMobile = useIsMobile();

  const [prompts, setPrompts] = useState<PromptSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [knownTags, setKnownTags] = useState<string[]>([]);
  const [sort, setSort] = useState<Sort>("updated");
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [importing, setImporting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const query = useCallback(
    (offset: number) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (search) params.set("q", search);
      if (tag) params.set("tag", tag);
      return `/api/prompts?${params}`;
    },
    [search, tag],
  );

  const fetchPrompts = useCallback(async () => {
    // Cancel the previous in-flight request.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("loading");
    try {
      const res = await fetch(query(0), { signal: controller.signal });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const list: PromptSummary[] = data.prompts || [];
      setPrompts(list);
      setTotal(typeof data.total === "number" ? data.total : list.length);
      // Tag chips come from the unfiltered list, so picking a tag or searching
      // keeps the others.
      if (!tag && !search) setKnownTags(tagsByUse(list));
      setStatus("ok");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setStatus("error");
    }
  }, [query, tag, search]);

  useEffect(() => {
    const timer = setTimeout(fetchPrompts, search ? 300 : 0);
    return () => {
      clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [fetchPrompts, search]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const res = await fetch(query(prompts.length));
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setPrompts((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...(data.prompts || []).filter((p: PromptSummary) => !seen.has(p.id))];
      });
      if (typeof data.total === "number") setTotal(data.total);
    } catch {
      toast.error("Weitere Prompts konnten nicht geladen werden.");
    } finally {
      setLoadingMore(false);
    }
  }

  const sorted = useMemo(() => {
    const list = [...prompts];
    if (sort === "title") list.sort((a, b) => a.title.localeCompare(b.title, "de", { sensitivity: "base" }));
    else if (sort === "created") list.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    return list;
  }, [prompts, sort]);

  const select = useCallback(
    (id: string | null) => {
      const href = id ? `/library?prompt=${encodeURIComponent(id)}` : "/library";
      if (isMobile) {
        router.push(href, { scroll: false });
        document.getElementById("main")?.scrollTo({ top: 0 });
      } else {
        router.replace(href, { scroll: false });
      }
    },
    [isMobile, router],
  );

  // J/K (and arrows from a focused row) walk the list on desktop.
  const step = useCallback(
    (delta: number) => {
      if (sorted.length === 0) return;
      const idx = sorted.findIndex((p) => p.id === selectedId);
      const next = sorted[Math.min(sorted.length - 1, Math.max(0, idx < 0 ? 0 : idx + delta))];
      if (!next) return;
      select(next.id);
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>(`[data-prompt-id="${CSS.escape(next.id)}"]`)?.focus({ preventScroll: false }),
      );
    },
    [sorted, selectedId, select],
  );
  useHotkeys({ j: () => step(1), k: () => step(-1) }, { enabled: !isMobile });

  async function handleImport(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Datei zu groß (max. 5 MB).");
      return;
    }
    setImporting(true);
    try {
      const text = await file.text();
      const res = await fetch("/api/prompts/import", {
        method: "POST",
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body: text,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(
          typeof data.error === "string" ? `Import fehlgeschlagen: ${data.error}` : `Import fehlgeschlagen (HTTP ${res.status}).`,
        );
        return;
      }
      toast.success(`Importiert: ${data.prompt?.title ?? file.name}`);
      await fetchPrompts();
      if (data.prompt?.id) select(data.prompt.id);
    } catch {
      toast.error("Import fehlgeschlagen.");
    } finally {
      setImporting(false);
    }
  }

  const filtersActive = !!search || !!tag;
  const libraryEmpty = status === "ok" && prompts.length === 0 && !filtersActive;

  const header = (
    <PageHeader
      title="Bibliothek"
      description="Gespeicherte Prompts mit Versionen und Testfällen – starte sie im Assistenten oder teste sie im Playground."
      actions={
        <>
          <input
            ref={fileRef}
            type="file"
            accept=".json,.yaml,.yml,application/json,text/yaml"
            className="hidden"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void handleImport(f);
            }}
          />
          <Button variant="ghost" loading={importing} onClick={() => fileRef.current?.click()} tooltip="JSON- oder YAML-Export eines Prompts">
            {importing ? null : <FileUp aria-hidden />} Importieren
          </Button>
          {/* The empty state carries the same action. */}
          {libraryEmpty ? null : (
            <Button variant="outline" asChild>
              <Link href="/builder">
                <Hammer aria-hidden /> Prompt bauen
              </Link>
            </Button>
          )}
        </>
      }
    />
  );

  // Phone: list → detail as separate screens.
  if (isMobile && selectedId) {
    return (
      <PromptDetail
        key={selectedId}
        promptId={selectedId}
        mobile
        onDeleted={() => {
          void fetchPrompts();
          router.replace("/library");
        }}
        onDuplicated={(id) => {
          void fetchPrompts();
          router.replace(`/library?prompt=${encodeURIComponent(id)}`);
        }}
      />
    );
  }

  if (libraryEmpty) {
    return (
      <div className="mx-auto w-full max-w-[1200px]">
        {header}
        <EmptyState
          icon={<Library />}
          title="Noch keine Prompts gespeichert."
          description="Baue einen Prompt im Builder oder starte mit einer Vorlage – gespeicherte Prompts landen hier, mit Versionen und Testfällen."
          action={
            <Button variant="primary" asChild>
              <Link href="/builder">
                <Hammer aria-hidden /> Prompt bauen
              </Link>
            </Button>
          }
          secondaryAction={
            <Button variant="outline" asChild>
              <Link href="/templates">
                <LayoutTemplate aria-hidden /> Aus Vorlage starten
              </Link>
            </Button>
          }
        />
      </div>
    );
  }

  const list = (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="space-y-2">
        <InputGroup
          type="search"
          leading={<Search />}
          aria-label="Prompts durchsuchen"
          placeholder="Titel, Beschreibung oder Inhalt …"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex items-center gap-2">
          <SimpleSelect
            aria-label="Sortierung"
            options={SORT_OPTIONS}
            value={sort}
            onValueChange={(v) => setSort(v as Sort)}
            className="w-auto min-w-40"
          />
          <span className="ml-auto text-xs tabular-nums text-subtle-foreground" aria-live="polite">
            {status === "ok" ? `${total} ${total === 1 ? "Prompt" : "Prompts"}` : ""}
          </span>
        </div>
        {knownTags.length > 0 ? (
          <div role="group" aria-label="Nach Tag filtern" className="flex flex-wrap gap-1.5">
            {knownTags.slice(0, 12).map((t) => (
              <ToggleChip key={t} pressed={tag === t} onPressedChange={(on) => setTag(on ? t : null)}>
                {t}
              </ToggleChip>
            ))}
          </div>
        ) : null}
      </div>

      {status === "error" ? (
        <Callout
          variant="danger"
          title="Prompts konnten nicht geladen werden"
          action={
            <Button variant="outline" size="sm" onClick={() => void fetchPrompts()}>
              <RotateCw aria-hidden /> Erneut versuchen
            </Button>
          }
        />
      ) : status === "loading" && prompts.length === 0 ? (
        <div className="space-y-2" aria-busy="true">
          <span className="sr-only">Prompts werden geladen …</span>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      ) : prompts.length === 0 ? (
        <EmptyState
          headingLevel={2}
          icon={<SearchX />}
          title={search ? `Keine Treffer für „${search}“` : "Keine Prompts mit diesem Tag"}
          action={
            <Button
              variant="outline"
              onClick={() => {
                setSearch("");
                setTag(null);
              }}
            >
              Filter zurücksetzen
            </Button>
          }
        />
      ) : (
        <ul
          aria-label="Prompts"
          className="-mx-1 min-h-0 flex-1 space-y-2 overflow-y-auto px-1 pb-1 md:pt-0.5"
          onKeyDown={(e) => {
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            const items = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-prompt-id]")];
            const i = items.indexOf(document.activeElement as HTMLElement);
            if (i < 0) return;
            e.preventDefault();
            items[Math.min(items.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
          }}
        >
          {sorted.map((p) => (
            <li key={p.id}>
              <PromptCard prompt={p} selected={!isMobile && p.id === selectedId} onClick={() => select(p.id)} />
            </li>
          ))}
          {prompts.length < total ? (
            <li className="pt-1">
              <Button variant="ghost" className="w-full" loading={loadingMore} onClick={() => void loadMore()}>
                Weitere laden ({total - prompts.length})
              </Button>
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );

  if (isMobile) {
    return (
      <div>
        {header}
        {list}
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-[calc(100dvh-3rem)] w-full max-w-[1400px] flex-col">
      {header}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,300px)_minmax(0,1fr)] gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <section aria-label="Prompt-Liste" className="flex min-h-0 flex-col">
          {list}
        </section>
        <section aria-label="Details" className="min-h-0 overflow-y-auto rounded-lg border border-border bg-surface p-4 lg:p-5">
          {selectedId ? (
            <PromptDetail
              key={selectedId}
              promptId={selectedId}
              mobile={false}
              onDeleted={() => {
                void fetchPrompts();
                select(null);
              }}
              onDuplicated={(id) => {
                void fetchPrompts();
                select(id);
              }}
            />
          ) : (
            <EmptyState
              icon={<Library />}
              title="Wähle einen Prompt"
              description="Inhalt, Versionen und Testfälle erscheinen hier. Mit J und K blätterst du durch die Liste."
            />
          )}
        </section>
      </div>
    </div>
  );
}
