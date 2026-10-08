import { useBuilderStore } from "@/stores/builder-store";
import { buildXml } from "@/lib/prompt-engine/xml-builder";
import type { PromptStructured } from "@/lib/ai/types";
import { applyDraftChange, xmlNeedsRebuild } from "./xml-sync";

/**
 * Store side of xml-sync.ts. The basis (the XML the fields last produced when
 * the XML was built from or synced with them) lives in localStorage next to
 * the persisted draft, so it also covers reloads and drafts loaded from the
 * library, a template or the playground.
 */
const BASIS_KEY = "pb-xml-basis";

function readBasis(): string | null {
  try {
    return localStorage.getItem(BASIS_KEY);
  } catch {
    return null;
  }
}

/** Records that the store's XML matches these fields (after a build, sync or load). */
export function markXmlInSync(structured: PromptStructured = useBuilderStore.getState().structured): void {
  try {
    localStorage.setItem(BASIS_KEY, buildXml(structured));
  } catch {
    /* storage blocked: the XML is then rebuilt whenever the fields are left */
  }
}

export function clearXmlBasis(): void {
  try {
    localStorage.removeItem(BASIS_KEY);
  } catch {
    /* ignore */
  }
}

/** Rebuilds the XML from the fields if they changed since it was built; returns whether it did. */
export function syncXmlFromFields(): boolean {
  const s = useBuilderStore.getState();
  if (!xmlNeedsRebuild(s.xmlContent, s.structured, readBasis())) return false;
  s.setXmlContent(buildXml(s.structured));
  markXmlInSync(s.structured);
  return true;
}

/**
 * Applies a change from the rail (technique, snippet, swarm) to the draft; on
 * Vorschau and Verfeinern it shows up in the XML right away. Returns false
 * when `change` returned null.
 */
export function updateDraft(change: (current: PromptStructured) => Partial<PromptStructured> | null): boolean {
  const s = useBuilderStore.getState();
  const result = applyDraftChange(
    { structured: s.structured, xmlContent: s.xmlContent, xmlStep: s.step === "preview" || s.step === "refine" },
    change,
  );
  if (!result) return false;
  s.updateStructured(result.structured);
  if (result.xml !== null) {
    s.setXmlContent(result.xml);
    markXmlInSync(result.structured);
  }
  return true;
}
