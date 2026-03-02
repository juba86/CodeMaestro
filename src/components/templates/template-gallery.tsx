"use client";

import { useState, useEffect } from "react";
import { useBuilderStore } from "@/stores/builder-store";
import { parseXml } from "@/lib/prompt-engine/xml-parser";
import { useRouter } from "next/navigation";
import { builtInTemplates } from "@/lib/templates/built-in";
import type { TemplateEntry } from "@/lib/templates/registry";
import { LayoutTemplate, ArrowRight, Network, Brain } from "lucide-react";
import { toast } from "sonner";

const categories = [
  { id: "all", label: "All" },
  { id: "development", label: "Development" },
  { id: "architecture", label: "Architecture" },
  { id: "ai-agents", label: "AI Agents / Swarms" },
  { id: "techniques", label: "Techniques" },
];

export function TemplateGallery() {
  const [templates, setTemplates] = useState<TemplateEntry[]>([]);
  const [category, setCategory] = useState("all");
  const [preview, setPreview] = useState<TemplateEntry | null>(null);
  const router = useRouter();
  const { updateStructured, setXmlContent, setStep } = useBuilderStore();

  useEffect(() => {
    // Load built-in templates immediately
    const builtIn: TemplateEntry[] = builtInTemplates.map((t) => ({
      ...t,
      isBuiltIn: true,
    }));
    setTemplates(builtIn);

    // Also try fetching from API for custom templates
    fetch("/api/templates")
      .then((r) => r.json())
      .then((d) => {
        const custom = (d.templates || []) as TemplateEntry[];
        const customSlugs = new Set(custom.map((t) => t.slug));
        setTemplates([
          ...builtIn.filter((t) => !customSlugs.has(t.slug)),
          ...custom,
        ]);
      })
      .catch(() => {});
  }, []);

  function handleUseTemplate(template: TemplateEntry) {
    const parsed = parseXml(template.content);
    updateStructured(parsed);
    setXmlContent(template.content);
    setStep("edit");
    toast.success(`Loaded template: ${template.name}`);
    router.push("/builder");
  }

  const filtered = category === "all" ? templates : templates.filter((t) => t.category === category);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Templates</h1>

      <div className="flex gap-2">
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => setCategory(c.id)}
            className={`px-3 py-1.5 text-sm rounded-md ${
              category === c.id
                ? "bg-primary text-primary-foreground"
                : "border border-input hover:bg-accent"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((t) => (
          <div
            key={t.slug}
            className="p-4 rounded-lg border border-border hover:border-primary/50 transition-colors space-y-3"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                {t.category === "ai-agents" ? (
                  <Network size={18} className="text-primary" />
                ) : t.category === "techniques" ? (
                  <Brain size={18} className="text-primary" />
                ) : (
                  <LayoutTemplate size={18} className="text-primary" />
                )}
                <h3 className="font-semibold text-sm">{t.name}</h3>
              </div>
              {t.isBuiltIn && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent text-muted-foreground">
                  Built-in
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{t.description}</p>
            <div className="flex gap-2">
              <button
                onClick={() => setPreview(preview?.slug === t.slug ? null : t)}
                className="px-2 py-1 text-xs rounded border border-input hover:bg-accent"
              >
                {preview?.slug === t.slug ? "Hide" : "Preview"}
              </button>
              <button
                onClick={() => handleUseTemplate(t)}
                className="px-2 py-1 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1"
              >
                Use <ArrowRight size={12} />
              </button>
            </div>
            {preview?.slug === t.slug && (
              <pre className="mt-2 p-3 rounded border border-border bg-accent/30 text-xs font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">
                {t.content}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
