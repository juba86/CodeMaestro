"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { BookOpen, Check, Copy, Cpu, FileText, FileUp, MoreHorizontal, Plus, RotateCw, Search, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatRelative } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Button, IconButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Field, FieldError, FieldHint, FieldLabel } from "@/components/ui/field";
import { Input, InputGroup } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SegmentedControl, SegmentedItem } from "@/components/ui/segmented-control";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { confirm } from "@/components/ui/confirm";
import { useCopy } from "@/components/ui/copy-text";

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

// Same limit as createKnowledgeDocSchema.
const MAX_CHARS = 500_000;
const TEXT_FILES = ".md,.markdown,.txt,.text,.rst,.adoc,.json,.yaml,.yml,.toml,.csv,.xml,.html,.htm,.log";

const EMBED_DOWN = "Ollama nicht erreichbar – die Wissensbasis ist gerade inaktiv.";

function sourceLabel(source: string): string {
  return !source || source === "manual" ? "Text" : source;
}

function ResultItem({ r }: { r: SearchResult }) {
  const { copied, copy } = useCopy();
  return (
    <li className="space-y-1.5 rounded-lg border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <FileText aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">{r.docTitle}</span>
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <Badge variant={r.score >= 0.6 ? "success" : "neutral"} className="tabular-nums">
            <span className="sr-only">Übereinstimmung </span>
            {Math.round(r.score * 100)} %
          </Badge>
          <IconButton
            aria-label={copied ? "Kopiert" : "Abschnitt kopieren"}
            size="icon-sm"
            className="-my-1.5 size-10 md:my-0 md:size-7"
            onClick={() => void copy(r.content)}
          >
            {copied ? <Check className="text-success" /> : <Copy />}
          </IconButton>
        </div>
      </div>
      <p className="line-clamp-6 whitespace-pre-wrap break-words text-ui text-foreground">{r.content}</p>
    </li>
  );
}

export function KnowledgeView() {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [embedDown, setEmbedDown] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [mode, setMode] = useState<"text" | "file">("text");
  const [draft, setDraft] = useState({ title: "", source: "", content: "" });
  const [errors, setErrors] = useState<{ title?: string; content?: string }>({});
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[] | null>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await fetch("/api/knowledge");
      if (!res.ok) throw new Error(String(res.status));
      const d = await res.json();
      setDocs(d.docs || []);
      setStatus("ok");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openAdd() {
    setDraft({ title: "", source: "", content: "" });
    setErrors({});
    setMode("text");
    setAddOpen(true);
  }

  async function readFile(file: File) {
    if (file.size > MAX_CHARS * 4) {
      toast.error("Datei zu groß für die Wissensbasis.");
      return;
    }
    try {
      const text = await file.text();
      setDraft({ title: draft.title || file.name.replace(/\.[^.]+$/, ""), source: file.name, content: text });
      setErrors({});
    } catch {
      toast.error("Datei konnte nicht gelesen werden.");
    }
  }

  async function addDoc() {
    const next: typeof errors = {};
    if (!draft.title.trim()) next.title = "Titel fehlt.";
    if (!draft.content.trim()) next.content = mode === "file" ? "Erst eine Datei wählen." : "Inhalt fehlt.";
    else if (draft.content.length > MAX_CHARS) next.content = "Zu lang (max. 500.000 Zeichen).";
    setErrors(next);
    if (next.title || next.content) return;
    setSaving(true);
    try {
      const res = await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title.trim(),
          source: draft.source.trim() || "manual",
          content: draft.content,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setEmbedDown(false);
        const n = data.doc?.chunkCount ?? 0;
        toast.success(`Indexiert: ${n} ${n === 1 ? "Abschnitt" : "Abschnitte"}.`);
        setAddOpen(false);
        void load();
      } else if (data.code === "EMBED_FAILED") {
        setEmbedDown(true);
        toast.error(EMBED_DOWN);
      } else {
        toast.error(typeof data.error === "string" ? `Indexieren fehlgeschlagen: ${data.error}` : "Indexieren fehlgeschlagen.");
      }
    } catch {
      toast.error("Indexieren fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteDoc(doc: KnowledgeDoc) {
    const ok = await confirm({
      title: "Dokument löschen?",
      description: `„${doc.title}“ und seine ${doc.chunkCount} Abschnitte werden aus der Wissensbasis entfernt.`,
      confirmLabel: "Löschen",
      tone: "danger",
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/knowledge/${doc.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error(String(res.status));
      toast.success("Gelöscht");
      setResults((prev) => prev?.filter((r) => r.docId !== doc.id) ?? null);
      void load();
    } catch {
      toast.error("Löschen fehlgeschlagen.");
    }
  }

  async function runSearch() {
    if (!query.trim() || searching) return;
    setSearching(true);
    try {
      const res = await fetch("/api/knowledge/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, topK: 5 }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setEmbedDown(false);
        setResults(data.results || []);
      } else if (data.code === "EMBED_FAILED") {
        setEmbedDown(true);
        setResults(null);
      } else {
        toast.error("Suche fehlgeschlagen.");
      }
    } catch {
      toast.error("Suche fehlgeschlagen.");
    } finally {
      setSearching(false);
    }
  }

  const chunkTotal = docs.reduce((n, d) => n + d.chunkCount, 0);
  const empty = status === "ok" && docs.length === 0;

  const statusStrip = (
    <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <Cpu aria-hidden className="size-3.5 text-subtle-foreground" />
        Embedding: <span className="font-mono text-foreground">bge-m3</span> über Ollama auf dem Server
      </span>
      <span className="inline-flex items-center gap-1.5">
        <ShieldCheck aria-hidden className="size-3.5 text-subtle-foreground" />
        Nichts verlässt den Server
      </span>
      {status === "ok" && docs.length > 0 ? (
        <span className="tabular-nums">
          {docs.length} {docs.length === 1 ? "Dokument" : "Dokumente"} · {chunkTotal.toLocaleString("de-DE")}{" "}
          {chunkTotal === 1 ? "Abschnitt" : "Abschnitte"}
        </span>
      ) : null}
    </div>
  );

  const embedCallout = embedDown ? (
    <Callout variant="warning" title={EMBED_DOWN} announce className="mb-5" onDismiss={() => setEmbedDown(false)}>
      Auf dem Server muss Ollama laufen und das Modell geladen sein:{" "}
      <code className="rounded-sm bg-surface-2 px-1 font-mono text-xs">ollama pull bge-m3</code>
    </Callout>
  ) : null;

  const docList =
    status === "loading" ? (
      <div className="space-y-2" aria-busy="true">
        <span className="sr-only">Dokumente werden geladen …</span>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-14 w-full rounded-lg" />
        ))}
      </div>
    ) : status === "error" ? (
      <Callout
        variant="danger"
        title="Dokumente konnten nicht geladen werden"
        action={
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RotateCw aria-hidden /> Erneut versuchen
          </Button>
        }
      />
    ) : (
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div
          aria-hidden
          className="hidden grid-cols-[minmax(0,1fr)_minmax(0,10rem)_6rem_7rem_2.5rem] gap-3 border-b border-border bg-surface-2 px-3 py-2 text-xs font-medium text-subtle-foreground md:grid"
        >
          <span>Name</span>
          <span>Typ</span>
          <span className="text-right">Abschnitte</span>
          <span>Hinzugefügt</span>
          <span />
        </div>
        <ul aria-label="Dokumente" className="divide-y divide-border">
          {docs.map((d) => (
            <li
              key={d.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-3 py-2.5 md:grid-cols-[minmax(0,1fr)_minmax(0,10rem)_6rem_7rem_2.5rem]"
            >
              <span className="flex min-w-0 items-center gap-2">
                <FileText aria-hidden className="size-4 shrink-0 text-subtle-foreground" />
                <span className="truncate text-sm font-medium md:text-ui">{d.title}</span>
              </span>
              <span className="col-start-1 row-start-2 truncate pl-6 text-xs text-muted-foreground md:col-start-auto md:row-start-auto md:pl-0 md:text-ui">
                <span className="md:hidden">
                  {sourceLabel(d.source)} · {d.chunkCount} {d.chunkCount === 1 ? "Abschnitt" : "Abschnitte"} ·{" "}
                  {formatRelative(d.createdAt)}
                </span>
                <span className="hidden md:inline" title={sourceLabel(d.source)}>
                  <span className="sr-only">Typ: </span>
                  {sourceLabel(d.source)}
                </span>
              </span>
              <span className="hidden text-right text-ui tabular-nums text-muted-foreground md:block">
                <span className="sr-only">Abschnitte: </span>
                {d.chunkCount}
              </span>
              <span className="hidden text-ui text-muted-foreground md:block">
                <span className="sr-only">Hinzugefügt: </span>
                {formatRelative(d.createdAt)}
              </span>
              <span className="col-start-2 row-span-2 row-start-1 md:col-start-auto md:row-span-1 md:row-start-auto">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton aria-label={`Aktionen für „${d.title}“`}>
                      <MoreHorizontal />
                    </IconButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem variant="danger" onSelect={() => void deleteDoc(d)}>
                      <Trash2 /> Löschen
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </span>
            </li>
          ))}
        </ul>
      </div>
    );

  const searchPanel = (
    <section aria-labelledby="kb-search-title" className="space-y-3 rounded-lg border border-border bg-card p-4 shadow-xs">
      <div>
        <h2 id="kb-search-title" className="text-ui font-semibold">
          Suche testen
        </h2>
        <p className="text-xs text-muted-foreground">So findet ein Agent passende Abschnitte zu einer Frage.</p>
      </div>
      <form
        role="search"
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void runSearch();
        }}
      >
        <InputGroup
          leading={<Search />}
          type="search"
          aria-label="Suchanfrage"
          placeholder="z. B. Wie deployen wir?"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button
          type="submit"
          variant="secondary"
          loading={searching}
          disabledReason={!query.trim() ? "Erst eine Suchanfrage eingeben" : docs.length === 0 ? "Erst ein Dokument hinzufügen" : undefined}
        >
          Suchen
        </Button>
      </form>
      <div aria-live="polite" className="sr-only">
        {results ? `${results.length} ${results.length === 1 ? "Treffer" : "Treffer"}` : ""}
      </div>
      {results && results.length === 0 ? <p className="text-ui text-muted-foreground">Keine Treffer.</p> : null}
      {results && results.length > 0 ? (
        <ol className="space-y-2">
          {results.map((r) => (
            <ResultItem key={r.id} r={r} />
          ))}
        </ol>
      ) : null}
    </section>
  );

  return (
    <div className="mx-auto w-full max-w-[1200px]">
      <PageHeader
        title="Wissensbasis"
        description="Eigene Doku, Specs und Notizen, die Agenten automatisch heranziehen."
        actions={
          // The empty state carries the same action.
          empty ? null : (
            <Button variant="primary" onClick={openAdd} aria-haspopup="dialog">
              <Plus aria-hidden /> Dokument hinzufügen
            </Button>
          )
        }
      />
      {statusStrip}
      {embedCallout}

      {empty ? (
        <EmptyState
          icon={<BookOpen />}
          title="Noch keine Dokumente in der Wissensbasis."
          description="Lege eigene Doku, Specs und Notizen ab – Agenten ziehen passende Abschnitte automatisch heran. Dafür braucht der Server Ollama mit bge-m3; nichts verlässt den Server."
          action={
            <Button variant="primary" onClick={openAdd}>
              <Plus aria-hidden /> Erstes Dokument hinzufügen
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <section aria-labelledby="kb-docs-title" className="min-w-0 space-y-3">
            <h2 id="kb-docs-title" className="text-ui font-semibold">
              Dokumente
            </h2>
            {docList}
          </section>
          <div className="min-w-0">{searchPanel}</div>
        </div>
      )}

      <Sheet open={addOpen} onOpenChange={setAddOpen}>
        <SheetContent side="auto" size="lg">
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              void addDoc();
            }}
          >
            <SheetHeader>
              <SheetTitle>Dokument hinzufügen</SheetTitle>
              <SheetDescription>
                Der Text wird in Abschnitte zerlegt und lokal mit bge-m3 eingebettet. Nichts verlässt den Server.
              </SheetDescription>
            </SheetHeader>
            <SheetBody className="space-y-4">
              <SegmentedControl
                value={mode}
                onValueChange={(v) => setMode(v as "text" | "file")}
                stretch
                aria-label="Art der Eingabe"
                className="h-11 md:h-8"
              >
                <SegmentedItem value="text">Text einfügen</SegmentedItem>
                <SegmentedItem value="file">Textdatei laden</SegmentedItem>
              </SegmentedControl>

              {mode === "file" ? (
                <Field id="kb-file" invalid={!!errors.content && !draft.content}>
                  {/* Labels the visible button; the native input stays hidden. */}
                  <FieldLabel htmlFor="kb-file-button">Datei</FieldLabel>
                  <input
                    ref={fileRef}
                    type="file"
                    accept={TEXT_FILES}
                    className="sr-only"
                    tabIndex={-1}
                    aria-hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) void readFile(f);
                    }}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      id="kb-file-button"
                      type="button"
                      variant="outline"
                      aria-label="Datei wählen"
                      aria-describedby={
                        ["kb-file-status", "kb-file-hint", !draft.content && errors.content ? "kb-file-error" : ""]
                          .filter(Boolean)
                          .join(" ")
                      }
                      onClick={() => fileRef.current?.click()}
                    >
                      <FileUp aria-hidden /> Datei wählen
                    </Button>
                    <span id="kb-file-status" className="min-w-0 truncate text-ui text-muted-foreground">
                      {draft.source && draft.content
                        ? `${draft.source} · ${draft.content.length.toLocaleString("de-DE")} Zeichen`
                        : "Markdown, Text, JSON, YAML, CSV …"}
                    </span>
                  </div>
                  <FieldHint>Die Datei wird im Browser gelesen und als Text übernommen.</FieldHint>
                  {!draft.content ? <FieldError>{errors.content}</FieldError> : null}
                </Field>
              ) : null}

              <Field required invalid={!!errors.title}>
                <FieldLabel>Titel</FieldLabel>
                <Input
                  value={draft.title}
                  onChange={(e) => {
                    setDraft({ ...draft, title: e.target.value });
                    setErrors((x) => ({ ...x, title: undefined }));
                  }}
                  placeholder="z. B. Deploy-Handbuch"
                />
                <FieldError>{errors.title}</FieldError>
              </Field>
              <Field>
                <FieldLabel optional="optional">Quelle</FieldLabel>
                <Input
                  value={draft.source}
                  onChange={(e) => setDraft({ ...draft, source: e.target.value })}
                  placeholder="URL oder Dateiname"
                />
              </Field>
              {mode === "text" || draft.content ? (
                <Field required invalid={!!errors.content}>
                  <FieldLabel>Inhalt</FieldLabel>
                  <Textarea
                    autosize={{ min: 8, max: 20 }}
                    className="font-mono md:text-xs md:leading-5"
                    value={draft.content}
                    onChange={(e) => {
                      setDraft({ ...draft, content: e.target.value });
                      setErrors((x) => ({ ...x, content: undefined }));
                    }}
                    placeholder="Text einfügen – er wird automatisch in Abschnitte zerlegt und eingebettet …"
                  />
                  <FieldHint>
                    {draft.content.length.toLocaleString("de-DE")} von {MAX_CHARS.toLocaleString("de-DE")} Zeichen
                  </FieldHint>
                  <FieldError>{errors.content}</FieldError>
                </Field>
              ) : null}
            </SheetBody>
            <SheetFooter>
              <Button type="button" variant="ghost" size="lg" onClick={() => setAddOpen(false)}>
                Abbrechen
              </Button>
              <Button type="submit" variant="primary" size="lg" loading={saving}>
                Indexieren
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
