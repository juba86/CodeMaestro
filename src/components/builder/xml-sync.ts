import { buildXml } from "@/lib/prompt-engine/xml-builder";
import { parseXml, parseXmlPartial, tagPattern } from "@/lib/prompt-engine/xml-parser";
import type { PromptStructured } from "@/lib/ai/types";

/**
 * Pure rules for keeping the builder's fields and its XML in step. The fields
 * (Projekt, Abschnitte) and the XML (Vorschau, Verfeinern) are two views of
 * one draft; the XML can also be edited by hand.
 */

/**
 * What „In Abschnitte übernehmen" writes into the structured draft, or null
 * when the XML has no prompt tags at all. The XML is the source of truth for
 * the sections and examples it shows (a deleted section is cleared), but
 * technique and swarm config are builder settings the XML need not carry, so
 * they are kept unless the XML names them. An <examples> block whose items
 * can't be parsed keeps the current examples (same rule as parseXmlPartial).
 */
export function syncedStructured(xml: string, current: PromptStructured): PromptStructured | null {
  const partial = parseXmlPartial(xml);
  if (Object.keys(partial).length === 0) return null;
  const parsed = parseXml(xml);
  const hasExamplesBlock = new RegExp(`<${tagPattern("examples")}[\\s>]`, "i").test(xml);
  return {
    ...parsed,
    examples: partial.examples ?? (hasExamplesBlock ? current.examples : []),
    technique: parsed.technique ?? current.technique,
    swarmConfig: parsed.swarmConfig ?? current.swarmConfig,
  };
}

/**
 * Whether the XML has to be rebuilt from the fields. `basis` is the XML the
 * fields produced when the XML was last built from or synced with them (null
 * when unknown). Unchanged fields keep the XML as it is, so edits made by hand
 * in the Vorschau survive a look back at the fields; changed fields win.
 */
export function xmlNeedsRebuild(xml: string, structured: PromptStructured, basis: string | null): boolean {
  return !xml.trim() || basis === null || basis !== buildXml(structured);
}

/**
 * The draft after a change made outside the field forms (technique, snippet,
 * swarm). On the XML steps the XML is the source, so the change is applied on
 * top of what the XML says and the XML is rebuilt from the result; elsewhere
 * only the fields change. Returns null when `change` declines (nothing to do).
 */
export function applyDraftChange(
  draft: { structured: PromptStructured; xmlContent: string; xmlStep: boolean },
  change: (current: PromptStructured) => Partial<PromptStructured> | null,
): { structured: PromptStructured; xml: string | null } | null {
  const fromXml = draft.xmlStep && draft.xmlContent.trim() ? syncedStructured(draft.xmlContent, draft.structured) : null;
  const base = fromXml ?? draft.structured;
  const patch = change(base);
  if (!patch) return null;
  const structured = { ...base, ...patch };
  return { structured, xml: draft.xmlStep ? buildXml(structured) : null };
}
