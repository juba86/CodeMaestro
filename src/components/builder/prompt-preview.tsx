"use client";

import { useBuilderStore } from "@/stores/builder-store";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { XmlTagPalette } from "./xml-tag-palette";
import { PromptQualityPanel } from "./prompt-quality-panel";
import { parseXml, parseXmlPartial, tagPattern } from "@/lib/prompt-engine/xml-parser";
import type { PromptStructured } from "@/lib/ai/types";
import { Copy, Repeat, Terminal } from "lucide-react";
import { toast } from "sonner";

/**
 * What "Sync Back" writes into the structured draft, or null when the XML has
 * no prompt tags at all. The XML is the source of truth for the sections and
 * examples it shows (a deleted section is cleared), but technique and swarm
 * config are builder settings the XML need not carry, so they are kept unless
 * the XML names them. An <examples> block whose items can't be parsed keeps
 * the current examples (same rule as parseXmlPartial).
 */
function syncedStructured(xml: string, current: PromptStructured): PromptStructured | null {
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

export function PromptPreview() {
  const { xmlContent, setXmlContent, structured, updateStructured, setStep } = useBuilderStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();

  // Handoff to the Code Assistant, which prefills its input from sessionStorage;
  // "pb-assistant-mode" = "loop" additionally switches it to Loop mode.
  function handleSendToAssistant(mode?: "loop") {
    if (!xmlContent.trim()) { toast.error("Kein Prompt-Inhalt zum Senden."); return; }
    sessionStorage.setItem("pb-assistant-prompt", xmlContent);
    if (mode) sessionStorage.setItem("pb-assistant-mode", mode);
    else sessionStorage.removeItem("pb-assistant-mode");
    router.push("/assistant");
  }

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
    }
  }, [xmlContent]);

  function handleCopy() {
    navigator.clipboard.writeText(xmlContent);
    toast.success("Copied to clipboard!");
  }

  function handleInsertTag(tag: string) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = xmlContent.substring(start, end);
    const wrapped = `<${tag}>${selected}</${tag}>`;
    const newContent = xmlContent.substring(0, start) + wrapped + xmlContent.substring(end);
    setXmlContent(newContent);
  }

  function handleXmlChange(value: string) {
    setXmlContent(value);
  }

  function handleSyncBack() {
    const next = syncedStructured(xmlContent, structured);
    if (!next) {
      toast.error("Keine Prompt-Tags im XML gefunden — nichts übernommen.");
      return;
    }
    updateStructured(next);
    toast.success("Synced XML back to structured data");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">XML Preview</h2>
        <div className="flex flex-wrap gap-2">
          <button onClick={handleCopy} className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-md border border-input hover:bg-accent">
            <Copy size={14} /> Copy
          </button>
          <button onClick={handleSyncBack} className="px-3 py-1.5 text-sm rounded-md border border-input hover:bg-accent">
            Sync Back
          </button>
          <button
            onClick={() => handleSendToAssistant("loop")}
            className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-md border border-input hover:bg-accent"
            title="Startet den Prompt im Loop-Modus des Code Assistant: Der Server wiederholt ihn, bis der Agent das Abschluss-Signal ausgibt oder das Iterationslimit erreicht ist. Am besten mit einer Definition of Done und einem prüfbaren Check (z. B. Tests) im Prompt."
          >
            <Repeat size={14} /> Als Loop im Assistant starten
          </button>
          <button onClick={() => handleSendToAssistant()} className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90">
            <Terminal size={14} /> An Code Assistant
          </button>
        </div>
      </div>

      <XmlTagPalette onInsert={handleInsertTag} />

      <PromptQualityPanel xmlContent={xmlContent} />

      <textarea
        ref={textareaRef}
        className="w-full rounded-md border border-input bg-background px-4 py-3 font-mono text-sm min-h-[400px] focus:outline-none focus:ring-2 focus:ring-ring"
        value={xmlContent}
        onChange={(e) => handleXmlChange(e.target.value)}
        spellCheck={false}
      />

      <div className="flex gap-3">
        <button
          onClick={() => setStep("refine")}
          className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
        >
          Refine with AI
        </button>
        <button
          onClick={() => setStep("edit")}
          className="px-4 py-2 rounded-md border border-input text-sm hover:bg-accent"
        >
          Back to Editor
        </button>
      </div>
    </div>
  );
}
