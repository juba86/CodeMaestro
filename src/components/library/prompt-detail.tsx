"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Copy,
  CopyPlus,
  Download,
  FlaskConical,
  MoreHorizontal,
  Pencil,
  RotateCw,
  SquareTerminal,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useBuilderStore } from "@/stores/builder-store";
import { downloadExport, EXPORT_FORMATS, type ExportFormat } from "@/lib/exporters/prompt-exporter";
import { formatRelative } from "@/lib/format";
import { useShellChrome } from "@/hooks/use-shell-chrome";
import { AppBar } from "@/components/ui/app-bar";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { CodeBlock } from "@/components/ui/code-block";
import { confirm } from "@/components/ui/confirm";
import { copyText } from "@/components/ui/copy-text";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldLabel } from "@/components/ui/field";
import { SimpleSelect } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SendToAiButton } from "@/components/send-to-ai/send-to-ai";
import { VersionDiff } from "./version-diff";
import { TestCasePanel } from "./test-case-panel";
import { ASSISTANT_HANDOFF_URL, loadIntoBuilder, structuredOf, writeAssistantHandoff } from "./load-into-builder";

interface PromptFull {
  id: string;
  title: string;
  description: string;
  content: string;
  structured: string;
  updatedAt: string;
  tags: { id: string; tag: string }[];
  versions: { id: string; version: number; content: string; changelog: string; createdAt: string }[];
  testResults: { id: string; provider: string; model: string; latencyMs: number; createdAt: string }[];
}

// German names for the exporter's formats (the rest are product names).
const EXPORT_LABEL: Partial<Record<ExportFormat, string>> = { text: "Text (.txt)" };

/** German changelog for the server's default entries. */
function changelogLabel(c: string): string {
  if (c === "Initial version") return "Erste Version";
  if (c === "Imported") return "Importiert";
  const m = c.match(/^Version (\d+)$/);
  if (m) return `Version ${m[1]}`;
  const u = c.match(/^Updated: (.*)$/);
  if (u) return `Aktualisiert: ${u[1]}`;
  return c;
}

const metaLine = (p: { versions: { version: number }[]; updatedAt: string }) =>
  `${p.versions[0] ? `v${p.versions[0].version} · ` : ""}geändert ${formatRelative(p.updatedAt)}`;

const versionText = (v: { version: number; createdAt: string; changelog: string }) =>
  `v${v.version} · ${formatRelative(v.createdAt)}${v.changelog ? ` · ${changelogLabel(v.changelog)}` : ""}`;

/** Hides the shell's AppBar while the phone detail screen shows its own. */
function MobileChrome() {
  useShellChrome({ appBar: false });
  return null;
}

interface PromptDetailProps {
  promptId: string;
  /** Phone layout: own AppBar with a back link to the list. */
  mobile: boolean;
  onDeleted: (id: string) => void;
  onDuplicated: (newId: string) => void;
}

export function PromptDetail({ promptId, mobile, onDeleted, onDuplicated }: PromptDetailProps) {
  const router = useRouter();
  const [prompt, setPrompt] = useState<PromptFull | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing" | "error">("loading");
  const [tab, setTab] = useState("content");
  const [activeVersion, setActiveVersion] = useState<number | null>(null);
  const [compareVersion, setCompareVersion] = useState<number | null>(null);
  const [testCount, setTestCount] = useState<number | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const res = await fetch(`/api/prompts/${promptId}`);
      if (res.status === 404) {
        setState("missing");
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const d = await res.json();
      setPrompt(d.prompt);
      setActiveVersion(d.prompt?.versions[0]?.version ?? null);
      setState("ok");
    } catch {
      setState("error");
    }
  }, [promptId]);

  useEffect(() => {
    void load();
  }, [load]);

  const currentVersion = prompt?.versions.find((v) => v.version === activeVersion);
  const compareCurrent = compareVersion != null ? prompt?.versions.find((v) => v.version === compareVersion) : undefined;

  function handleRunInAssistant() {
    if (!prompt) return;
    if (!writeAssistantHandoff(prompt.content, prompt.title)) {
      toast.error("Übergabe an den Assistenten nicht möglich (Browser-Speicher gesperrt).");
      return;
    }
    router.push(ASSISTANT_HANDOFF_URL);
  }

  async function handleEdit() {
    if (!prompt) return;
    if (await loadIntoBuilder(prompt)) router.push("/builder");
  }

  async function handleCopy() {
    if (!prompt) return;
    if (await copyText(prompt.content)) toast.success("Kopiert");
    else toast.error("Kopieren nicht möglich.");
  }

  function handleExport(format: ExportFormat) {
    if (!prompt) return;
    try {
      let structuredData: Record<string, unknown> = {};
      try {
        structuredData = JSON.parse(prompt.structured);
      } catch {
        // If structured data is invalid JSON, export as empty object
      }
      downloadExport(
        {
          title: prompt.title,
          description: prompt.description,
          content: prompt.content,
          structured: structuredData,
          tags: prompt.tags.map((t) => t.tag),
        },
        format,
      );
      toast.success(`Exportiert als ${EXPORT_LABEL[format] ?? EXPORT_FORMATS.find((f) => f.id === format)?.label ?? format}`);
    } catch {
      toast.error("Export fehlgeschlagen.");
    }
  }

  async function handleDuplicate() {
    if (!prompt || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `${prompt.title} (Kopie)`.slice(0, 200),
          description: prompt.description,
          content: prompt.content,
          structured: JSON.stringify(structuredOf(prompt)),
          tags: prompt.tags.map((t) => t.tag),
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const d = await res.json();
      toast.success("Dupliziert");
      onDuplicated(d.prompt.id);
    } catch {
      toast.error("Duplizieren fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!prompt) return;
    const ok = await confirm({
      title: "Prompt löschen?",
      description: `„${prompt.title}“ wird mit allen Versionen und Testfällen gelöscht. Das lässt sich nicht rückgängig machen.`,
      confirmLabel: "Löschen",
      tone: "danger",
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/prompts/${prompt.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        const e = await res.json().catch(() => ({}));
        toast.error(typeof e.error === "string" ? `Löschen fehlgeschlagen: ${e.error}` : `Löschen fehlgeschlagen (HTTP ${res.status}).`);
        return;
      }
      // If the builder still has this prompt loaded, detach it so a later save
      // creates a new prompt instead of updating one that no longer exists.
      const builder = useBuilderStore.getState();
      if (builder.currentPromptId === prompt.id) {
        builder.setCurrentPromptId(null);
        builder.setProjectMeta(null);
      }
      toast.success("Gelöscht");
      onDeleted(prompt.id);
    } catch {
      toast.error("Löschen fehlgeschlagen.");
    }
  }

  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton aria-label="Weitere Aktionen" variant={mobile ? "ghost" : "outline"}>
          <MoreHorizontal />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={() => void handleCopy()}>
          <Copy /> Inhalt kopieren
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Download /> Exportieren
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {EXPORT_FORMATS.map((f) => (
              <DropdownMenuItem key={f.id} onSelect={() => handleExport(f.id)}>
                {EXPORT_LABEL[f.id] ?? f.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem onSelect={() => void handleDuplicate()}>
          <CopyPlus /> Duplizieren
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="danger" onSelect={() => void handleDelete()}>
          <Trash2 /> Löschen
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const appBar = mobile ? (
    <>
      <MobileChrome />
      <AppBar
        className="-mx-4 -mt-4 mb-4"
        back={{ href: "/library", label: "Bibliothek" }}
        title={prompt?.title ?? "Prompt"}
        titleAs="h1"
        subtitle={prompt ? metaLine(prompt) : undefined}
        actions={prompt ? menu : undefined}
      />
    </>
  ) : null;

  if (state !== "ok" || !prompt) {
    return (
      <div>
        {appBar}
        {state === "loading" ? (
          <div className="space-y-3" aria-busy="true">
            <span className="sr-only">Prompt wird geladen …</span>
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : (
          <Callout
            variant={state === "missing" ? "warning" : "danger"}
            title={state === "missing" ? "Prompt nicht gefunden" : "Prompt konnte nicht geladen werden"}
            action={
              state === "error" ? (
                <Button variant="outline" size="sm" onClick={() => void load()}>
                  <RotateCw aria-hidden /> Erneut versuchen
                </Button>
              ) : null
            }
          >
            {state === "missing" ? "Er wurde vermutlich gelöscht." : "Prüfe die Verbindung zum Server."}
          </Callout>
        )}
      </div>
    );
  }

  const shownContent = currentVersion?.content ?? prompt.content;
  const compareOptions = [
    { value: "", label: "Kein Vergleich" },
    ...prompt.versions
      .filter((v) => v.version !== activeVersion)
      .map((v) => ({ value: String(v.version), label: versionText(v) })),
  ];

  return (
    <article aria-labelledby={mobile ? undefined : "lib-detail-title"} className="min-w-0">
      {appBar}
      {!mobile ? (
        <header className="mb-4 space-y-1">
          <h2 id="lib-detail-title" className="text-lg font-semibold [overflow-wrap:anywhere]">
            {prompt.title}
          </h2>
          <p className="text-xs text-subtle-foreground">{metaLine(prompt)}</p>
        </header>
      ) : null}

      <div className="mb-4 flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Button variant="primary" onClick={handleRunInAssistant}>
          <SquareTerminal aria-hidden /> Im Assistent ausführen
        </Button>
        {/* Keyed by prompt: another prompt starts a fresh conversation. */}
        <SendToAiButton
          key={prompt.id}
          prompt={prompt.content}
          playgroundHref={`/playground?prompt=${encodeURIComponent(prompt.id)}`}
        />
        <Button variant="outline" onClick={() => router.push(`/playground?prompt=${encodeURIComponent(prompt.id)}`)}>
          <FlaskConical aria-hidden /> Im Playground testen
        </Button>
        <Button variant="outline" onClick={() => void handleEdit()}>
          <Pencil aria-hidden /> Im Builder bearbeiten
        </Button>
        {mobile ? null : menu}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="content">Inhalt</TabsTrigger>
          <TabsTrigger value="versions" count={prompt.versions.length} countLabel={`${prompt.versions.length} Versionen`}>
            Versionen
          </TabsTrigger>
          <TabsTrigger
            value="tests"
            count={testCount}
            countLabel={testCount != null ? `${testCount} Testfälle` : undefined}
          >
            Testfälle
          </TabsTrigger>
        </TabsList>

        <TabsContent value="content" className="space-y-3 pt-4">
          {prompt.description ? <p className="max-w-[70ch] text-sm text-foreground">{prompt.description}</p> : null}
          {prompt.tags.length > 0 ? (
            <ul aria-label="Tags" className="flex flex-wrap gap-1.5">
              {prompt.tags.map((t) => (
                <li key={t.id}>
                  <Badge variant="neutral">{t.tag}</Badge>
                </li>
              ))}
            </ul>
          ) : null}
          <CodeBlock code={prompt.content} title="Prompt (XML)" wrap className="max-h-[36rem]" copyLabel="Prompt kopieren" />
        </TabsContent>

        <TabsContent value="versions" className="space-y-3 pt-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel>Version</FieldLabel>
              <SimpleSelect
                options={prompt.versions.map((v) => ({ value: String(v.version), label: versionText(v) }))}
                value={activeVersion != null ? String(activeVersion) : ""}
                onValueChange={(v) => {
                  const n = Number(v);
                  setActiveVersion(n);
                  if (compareVersion === n) setCompareVersion(null);
                }}
              />
            </Field>
            {prompt.versions.length > 1 ? (
              <Field>
                <FieldLabel>Vergleichen mit</FieldLabel>
                <SimpleSelect
                  options={compareOptions}
                  value={compareVersion != null ? String(compareVersion) : ""}
                  onValueChange={(v) => setCompareVersion(v ? Number(v) : null)}
                />
              </Field>
            ) : null}
          </div>
          {compareCurrent ? (
            <VersionDiff
              from={compareCurrent.content}
              to={shownContent}
              fromLabel={`v${compareCurrent.version}`}
              toLabel={`v${currentVersion?.version ?? "?"}`}
            />
          ) : (
            <CodeBlock
              code={shownContent}
              title={currentVersion ? `v${currentVersion.version}` : "Inhalt"}
              wrap
              className="max-h-[36rem]"
              copyLabel="Version kopieren"
            />
          )}
        </TabsContent>

        {/* Mounted while hidden so the count in the tab is known up front. */}
        <TabsContent value="tests" forceMount className="pt-4 data-[state=inactive]:hidden">
          <TestCasePanel
            promptId={prompt.id}
            xmlContent={shownContent}
            versionLabel={currentVersion ? `v${currentVersion.version}` : undefined}
            onCountChange={setTestCount}
          />
        </TabsContent>
      </Tabs>
    </article>
  );
}
