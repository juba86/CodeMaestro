"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Blocks, Bot, Brain, Code2, Eye, LayoutTemplate, Network } from "lucide-react";
import { toast } from "sonner";
import { useBuilderStore } from "@/stores/builder-store";
import { parseXml } from "@/lib/prompt-engine/xml-parser";
import { builtInTemplates } from "@/lib/templates/built-in";
import type { TemplateEntry } from "@/lib/templates/registry";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { CodeBlock } from "@/components/ui/code-block";
import { EmptyState } from "@/components/ui/empty-state";
import { confirm } from "@/components/ui/confirm";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { techniqueName } from "@/components/builder/technique-labels";
import { markXmlInSync } from "@/components/builder/draft-sync";
import { TEMPLATE_CATEGORY_ORDER, TEMPLATE_DE, categoryLabel } from "./template-labels";

const BUILT_IN: TemplateEntry[] = builtInTemplates.map((t) => ({ ...t, isBuiltIn: true }));

const CATEGORY_ICON: Record<string, typeof LayoutTemplate> = {
  "agentic-coding": Bot,
  development: Code2,
  architecture: Blocks,
  "ai-agents": Network,
  techniques: Brain,
};

/** Display copy: German for built-ins, as written for user templates. */
function copyOf(t: TemplateEntry): { name: string; description: string } {
  return (t.isBuiltIn && TEMPLATE_DE[t.slug]) || { name: t.name, description: t.description };
}

/** Technique and swarm flags from the template's structured prompt (for the card tags). */
function metaOf(t: TemplateEntry): { technique?: string; swarm: boolean } {
  try {
    const s = JSON.parse(t.structured || "{}");
    return { technique: typeof s.technique === "string" ? s.technique : undefined, swarm: !!s.swarmConfig };
  } catch {
    return { swarm: false };
  }
}

export function TemplateGallery() {
  // Built-ins render immediately; custom templates are merged in once fetched.
  const [templates, setTemplates] = useState<TemplateEntry[]>(BUILT_IN);
  const [category, setCategory] = useState("all");
  // Kept after closing, so the sheet keeps its content while it animates out.
  const [preview, setPreview] = useState<TemplateEntry | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const router = useRouter();
  const loadDraft = useBuilderStore((s) => s.loadDraft);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/templates", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : { templates: [] }))
      .then((d) => {
        const custom = (d.templates || []) as TemplateEntry[];
        if (custom.length === 0) return;
        const customSlugs = new Set(custom.map((t) => t.slug));
        setTemplates([...BUILT_IN.filter((t) => !customSlugs.has(t.slug)), ...custom]);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of templates) counts.set(t.category, (counts.get(t.category) ?? 0) + 1);
    const known = TEMPLATE_CATEGORY_ORDER.filter((c) => counts.has(c));
    const other = [...counts.keys()].filter((c) => !TEMPLATE_CATEGORY_ORDER.includes(c)).sort();
    return [...known, ...other].map((id) => ({ id, label: categoryLabel(id), count: counts.get(id) ?? 0 }));
  }, [templates]);

  // Grouped by the filter order, so "Alle" also starts with agentic coding.
  const filtered = useMemo(() => {
    const rank = new Map(categories.map((c, i) => [c.id, i]));
    const list = category === "all" ? templates : templates.filter((t) => t.category === category);
    return [...list].sort((a, b) => (rank.get(a.category) ?? 99) - (rank.get(b.category) ?? 99));
  }, [templates, category, categories]);

  async function handleUseTemplate(template: TemplateEntry) {
    // A template starts a fresh, unsaved draft — never an edit of whatever
    // saved project was loaded before (a later save would overwrite it).
    const b = useBuilderStore.getState();
    if (
      b.xmlContent.trim() &&
      !b.currentPromptId &&
      b.xmlContent !== template.content &&
      !(await confirm({
        title: "Entwurf ersetzen?",
        description: "Im Builder liegt ein ungespeicherter Entwurf. Er wird durch die Vorlage ersetzt.",
        confirmLabel: "Ersetzen",
        tone: "danger",
      }))
    ) {
      return;
    }
    loadDraft({ content: template.content, structured: parseXml(template.content) });
    markXmlInSync();
    toast.success(`Vorlage geladen: ${copyOf(template).name}`);
    setPreviewOpen(false);
    router.push("/builder");
  }

  const previewCopy = preview ? copyOf(preview) : null;

  return (
    <div className="mx-auto w-full max-w-[1200px]">
      <PageHeader
        title="Vorlagen"
        description="Bewährte Ausgangspunkte für Prompts. „Verwenden“ öffnet eine Kopie als neuen Entwurf im Builder."
      />

      <div
        role="group"
        aria-label="Nach Kategorie filtern"
        className="-mx-4 mb-5 flex gap-1.5 overflow-x-auto px-4 pb-1 scrollbar-none md:mx-0 md:flex-wrap md:overflow-visible md:px-0"
      >
        <ToggleChip size="md" pressed={category === "all"} onPressedChange={() => setCategory("all")}>
          Alle <span className="tabular-nums text-subtle-foreground">{templates.length}</span>
        </ToggleChip>
        {categories.map((c) => (
          <ToggleChip
            key={c.id}
            size="md"
            pressed={category === c.id}
            onPressedChange={(on) => setCategory(on ? c.id : "all")}
          >
            {c.label} <span className="tabular-nums text-subtle-foreground">{c.count}</span>
          </ToggleChip>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={<LayoutTemplate />} title="Keine Vorlagen in dieser Kategorie." />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((t) => {
            const Icon = CATEGORY_ICON[t.category] ?? LayoutTemplate;
            const { name, description } = copyOf(t);
            const meta = metaOf(t);
            return (
              <li key={t.slug} className="flex flex-col rounded-lg border border-border bg-card p-4 shadow-xs">
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden
                    className="grid size-9 shrink-0 place-items-center rounded-md border border-primary-border bg-primary-subtle text-primary-text"
                  >
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-semibold leading-5 md:text-ui">{name}</h2>
                    <p className="text-xs text-subtle-foreground">{categoryLabel(t.category)}</p>
                  </div>
                  {!t.isBuiltIn ? <Badge variant="brand">Eigene</Badge> : null}
                </div>
                <p className="mt-2.5 line-clamp-3 flex-1 text-ui text-muted-foreground">{description}</p>
                {meta.technique || meta.swarm ? (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {meta.technique ? <Badge variant="outline">{techniqueName(meta.technique)}</Badge> : null}
                    {meta.swarm ? <Badge variant="outline">Schwarm</Badge> : null}
                  </div>
                ) : null}
                <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
                  <Button variant="primary" onClick={() => void handleUseTemplate(t)}>
                    Verwenden <ArrowRight aria-hidden />
                    <span className="sr-only">: {name}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    aria-haspopup="dialog"
                    onClick={() => {
                      setPreview(t);
                      setPreviewOpen(true);
                    }}
                  >
                    <Eye aria-hidden /> Vorschau
                    <span className="sr-only">: {name}</span>
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Sheet open={previewOpen} onOpenChange={setPreviewOpen}>
        <SheetContent side="auto" size="lg">
          {preview && previewCopy ? (
            <>
              <SheetHeader>
                <SheetTitle>{previewCopy.name}</SheetTitle>
                <SheetDescription>{previewCopy.description}</SheetDescription>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <Badge variant="neutral">{categoryLabel(preview.category)}</Badge>
                  {metaOf(preview).technique ? (
                    <Badge variant="outline">{techniqueName(metaOf(preview).technique!)}</Badge>
                  ) : null}
                  {!preview.isBuiltIn ? <Badge variant="brand">Eigene</Badge> : null}
                </div>
              </SheetHeader>
              <SheetBody>
                <CodeBlock code={preview.content} title="Prompt (XML)" wrap copyLabel="Vorlage kopieren" />
              </SheetBody>
              <SheetFooter>
                <Button variant="primary" size="lg" onClick={() => void handleUseTemplate(preview)}>
                  Verwenden <ArrowRight aria-hidden />
                </Button>
              </SheetFooter>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
