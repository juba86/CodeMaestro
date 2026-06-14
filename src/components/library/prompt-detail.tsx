"use client";

import { useState, useEffect } from "react";
import { ArrowLeft, Trash2, Copy, Play, GitCompare } from "lucide-react";
import { useBuilderStore } from "@/stores/builder-store";
import { parseXml } from "@/lib/prompt-engine/xml-parser";
import { downloadExport, EXPORT_FORMATS, type ExportFormat } from "@/lib/exporters/prompt-exporter";
import { VersionDiff } from "./version-diff";
import { TestCasePanel } from "./test-case-panel";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

interface PromptFull {
  id: string;
  title: string;
  description: string;
  content: string;
  structured: string;
  tags: { id: string; tag: string }[];
  versions: { id: string; version: number; content: string; changelog: string; createdAt: string }[];
  testResults: { id: string; provider: string; model: string; latencyMs: number; createdAt: string }[];
}

interface PromptDetailProps {
  promptId: string;
  onBack: () => void;
  onDelete: () => void;
  onRefresh: () => void;
}

export function PromptDetail({ promptId, onBack, onDelete, onRefresh }: PromptDetailProps) {
  const [prompt, setPrompt] = useState<PromptFull | null>(null);
  const [activeVersion, setActiveVersion] = useState<number | null>(null);
  const [compareVersion, setCompareVersion] = useState<number | null>(null);
  const router = useRouter();
  const { updateStructured, setXmlContent, setCurrentPromptId, setStep } = useBuilderStore();

  useEffect(() => {
    fetch(`/api/prompts/${promptId}`)
      .then((r) => r.json())
      .then((d) => {
        setPrompt(d.prompt);
        if (d.prompt?.versions.length > 0) setActiveVersion(d.prompt.versions[0].version);
      })
      .catch(() => toast.error("Failed to load prompt"));
  }, [promptId]);

  if (!prompt) return <p className="text-sm text-muted-foreground">Loading...</p>;

  const currentVersion = prompt.versions.find((v) => v.version === activeVersion);
  const compareCurrent = compareVersion != null
    ? prompt.versions.find((v) => v.version === compareVersion)
    : undefined;

  function handleEdit() {
    const parsed = parseXml(prompt!.content);
    updateStructured(parsed);
    setXmlContent(prompt!.content);
    setCurrentPromptId(prompt!.id);
    setStep("edit");
    router.push("/builder");
  }

  function handleCopy() {
    navigator.clipboard.writeText(prompt!.content);
    toast.success("Copied to clipboard!");
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
        format
      );
      toast.success(`Exported as ${format.toUpperCase()}`);
    } catch {
      toast.error(`Export failed`);
    }
  }

  function handleDelete() {
    if (!window.confirm("Delete this prompt? This action cannot be undone.")) return;
    onDelete();
  }

  function handleTest() {
    setXmlContent(prompt!.content);
    setCurrentPromptId(prompt!.id);
    router.push("/playground");
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft size={16} /> Back to Library
      </button>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{prompt.title}</h1>
          {prompt.description && <p className="text-sm text-muted-foreground mt-1">{prompt.description}</p>}
        </div>
        <div className="flex gap-2">
          <button onClick={handleEdit} className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90">
            Edit
          </button>
          <button onClick={handleTest} className="px-3 py-1.5 text-sm rounded-md border border-input hover:bg-accent flex items-center gap-1">
            <Play size={14} /> Test
          </button>
          <button onClick={handleCopy} className="p-1.5 rounded-md border border-input hover:bg-accent" aria-label="Copy to clipboard">
            <Copy size={14} />
          </button>
          <select
            aria-label="Export prompt"
            title="Export as…"
            className="rounded-md border border-input bg-background px-2 py-1.5 text-xs hover:bg-accent"
            value=""
            onChange={(e) => {
              if (e.target.value) handleExport(e.target.value as ExportFormat);
              e.target.value = "";
            }}
          >
            <option value="" disabled>Export ▾</option>
            {EXPORT_FORMATS.map((f) => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </select>
          <button onClick={handleDelete} className="p-1.5 rounded-md border border-input hover:bg-accent text-destructive" aria-label="Delete prompt">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {prompt.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {prompt.tags.map((t) => (
            <span key={t.id} className="px-2 py-0.5 text-xs rounded bg-accent">{t.tag}</span>
          ))}
        </div>
      )}

      {/* Version timeline */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Versions ({prompt.versions.length})</h3>
          {prompt.versions.length > 1 && (
            <div className="flex items-center gap-2">
              <GitCompare size={14} className="text-muted-foreground" />
              <select
                aria-label="Compare against version"
                className="rounded-md border border-input bg-background px-2 py-1 text-xs"
                value={compareVersion ?? ""}
                onChange={(e) => setCompareVersion(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">Compare with…</option>
                {prompt.versions
                  .filter((v) => v.version !== activeVersion)
                  .map((v) => (
                    <option key={v.id} value={v.version}>vs. v{v.version}</option>
                  ))}
              </select>
            </div>
          )}
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {prompt.versions.map((v) => (
            <button
              key={v.id}
              onClick={() => { setActiveVersion(v.version); if (compareVersion === v.version) setCompareVersion(null); }}
              className={`shrink-0 px-3 py-1.5 text-xs rounded-md ${
                activeVersion === v.version
                  ? "bg-primary text-primary-foreground"
                  : "border border-input hover:bg-accent"
              }`}
            >
              v{v.version} - {new Date(v.createdAt).toLocaleDateString()}
            </button>
          ))}
        </div>
      </div>

      {/* Content or diff */}
      {compareCurrent ? (
        <VersionDiff
          from={compareCurrent.content}
          to={currentVersion?.content || prompt.content}
          fromLabel={`v${compareCurrent.version}`}
          toLabel={`v${currentVersion?.version ?? "current"}`}
        />
      ) : (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">
            {currentVersion ? `Content (v${currentVersion.version})` : "Content"}
          </h3>
          <pre className="p-4 rounded-lg border border-border bg-accent/30 text-sm font-mono whitespace-pre-wrap overflow-x-auto max-h-[500px] overflow-y-auto">
            {currentVersion?.content || prompt.content}
          </pre>
          {currentVersion?.changelog && (
            <p className="text-xs text-muted-foreground">Changelog: {currentVersion.changelog}</p>
          )}
        </div>
      )}

      {/* Evaluation test cases */}
      <TestCasePanel promptId={prompt.id} xmlContent={currentVersion?.content || prompt.content} />
    </div>
  );
}
