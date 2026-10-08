import { useBuilderStore } from "@/stores/builder-store";
import { parseXml } from "@/lib/prompt-engine/xml-parser";
import type { PromptStructured } from "@/lib/ai/types";
import { confirm } from "@/components/ui/confirm";
import { markXmlInSync } from "@/components/builder/draft-sync";

/** A saved prompt as GET /api/prompts/[id] returns it (the fields the builder needs). */
export interface SavedPrompt {
  id: string;
  title: string;
  description: string;
  content: string;
  structured: string;
  tags: { tag: string }[];
}

/** The persisted structured JSON, or the XML re-parsed when it is missing or broken. */
export function structuredOf(p: Pick<SavedPrompt, "structured" | "content">): PromptStructured {
  try {
    const parsed = JSON.parse(p.structured || "{}");
    return parsed && Object.keys(parsed).length > 0 ? parsed : parseXml(p.content);
  } catch {
    return parseXml(p.content);
  }
}

/**
 * Loads a saved prompt into the builder wholesale (id, metadata, structured
 * and XML always belong to the same prompt). An unsaved builder draft is only
 * replaced after confirmation. Resolves false when the user keeps the draft.
 */
export async function loadIntoBuilder(p: SavedPrompt): Promise<boolean> {
  const b = useBuilderStore.getState();
  const unsavedDraft = !!b.xmlContent.trim() && !b.currentPromptId && b.xmlContent !== p.content;
  if (
    unsavedDraft &&
    !(await confirm({
      title: "Entwurf ersetzen?",
      description: `Im Builder liegt ein ungespeicherter Entwurf. Er wird durch „${p.title}“ ersetzt.`,
      confirmLabel: "Ersetzen",
      tone: "danger",
    }))
  ) {
    return false;
  }
  b.loadProject({
    id: p.id,
    title: p.title,
    description: p.description,
    tags: p.tags.map((t) => t.tag),
    content: p.content,
    structured: structuredOf(p),
  });
  // The saved XML is the prompt as stored: keep it until the fields change.
  markXmlInSync();
  return true;
}

/**
 * „Im Assistent ausführen": the assistant reads this once on
 * /assistant?new=1&handoff=1 and prefills the new session's composer.
 * Returns false when sessionStorage is unavailable.
 */
export function writeAssistantHandoff(prompt: string, title?: string): boolean {
  try {
    sessionStorage.setItem("cm-assistant-handoff", JSON.stringify({ prompt, title }));
    return true;
  } catch {
    return false;
  }
}

export const ASSISTANT_HANDOFF_URL = "/assistant?new=1&handoff=1";
