import { builtInTemplates, type BuiltInTemplate } from "./built-in";

export interface TemplateEntry {
  slug: string;
  name: string;
  description: string;
  category: string;
  content: string;
  structured: string;
  isBuiltIn: boolean;
}

export async function getAllTemplates(): Promise<TemplateEntry[]> {
  // Fetch custom templates from DB
  let customTemplates: TemplateEntry[] = [];
  try {
    const res = await fetch("/api/templates");
    const data = await res.json();
    customTemplates = (data.templates || []).map((t: TemplateEntry) => ({
      ...t,
      isBuiltIn: t.isBuiltIn ?? false,
    }));
  } catch {
    // Offline or API error - use built-ins only
  }

  // Merge built-in + custom, built-in first
  const builtIn: TemplateEntry[] = builtInTemplates.map((t) => ({
    ...t,
    isBuiltIn: true,
  }));

  // Custom templates can override built-in by slug
  const customSlugs = new Set(customTemplates.map((t) => t.slug));
  const merged = [
    ...builtIn.filter((t) => !customSlugs.has(t.slug)),
    ...customTemplates,
  ];

  return merged;
}

export function getBuiltInTemplate(slug: string): BuiltInTemplate | undefined {
  return builtInTemplates.find((t) => t.slug === slug);
}
