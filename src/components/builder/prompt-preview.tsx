"use client";

import { useBuilderStore } from "@/stores/builder-store";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { XmlTagPalette } from "./xml-tag-palette";
import { PromptQualityPanel } from "./prompt-quality-panel";
import { buildXml } from "@/lib/prompt-engine/xml-builder";
import { parseXml } from "@/lib/prompt-engine/xml-parser";
import { Copy, Terminal } from "lucide-react";
import { toast } from "sonner";

export function PromptPreview() {
  const { xmlContent, setXmlContent, updateStructured, setStep } = useBuilderStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();

  function handleSendToAssistant() {
    if (!xmlContent.trim()) { toast.error("Kein Prompt-Inhalt zum Senden."); return; }
    sessionStorage.setItem("pb-assistant-prompt", xmlContent);
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
    const parsed = parseXml(xmlContent);
    updateStructured(parsed);
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
          <button onClick={handleSendToAssistant} className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90">
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
