"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Copy, FlaskConical, MoreHorizontal, Repeat, SquareTerminal, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { useBuilderStore } from "@/stores/builder-store";
import type { PromptStructured } from "@/lib/ai/types";
import { Button, IconButton } from "@/components/ui/button";
import { Field, FieldHint, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { copyText } from "@/components/ui/copy-text";
import { ASSISTANT_HANDOFF_URL, writeAssistantHandoff } from "@/components/library/load-into-builder";
import { XmlTagPalette } from "./xml-tag-palette";
import { fieldDomId } from "./lint-labels";
import { StepFooter } from "./step-footer";
import { syncedStructured } from "./xml-sync";
import { markXmlInSync } from "./draft-sync";

/** Title for the assistant handoff: the saved project's title, else the goal's first line. */
function handoffTitle(title: string | undefined, structured: PromptStructured): string | undefined {
  if (title?.trim()) return title.trim();
  const line = structured.instructions.trim().split("\n")[0] ?? "";
  return line ? line.slice(0, 80) : undefined;
}

export function PromptPreview({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const xmlContent = useBuilderStore((s) => s.xmlContent);
  const setXmlContent = useBuilderStore((s) => s.setXmlContent);
  const structured = useBuilderStore((s) => s.structured);
  const updateStructured = useBuilderStore((s) => s.updateStructured);
  const projectMeta = useBuilderStore((s) => s.projectMeta);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();
  const empty = !xmlContent.trim();

  // „Im Assistent ausführen": a new session with the prompt in its composer.
  function handleRunInAssistant() {
    if (empty) return;
    if (!writeAssistantHandoff(xmlContent, handoffTitle(projectMeta?.title, structured))) {
      toast.error("Übergabe an den Assistenten nicht möglich (Browser-Speicher gesperrt).");
      return;
    }
    router.push(ASSISTANT_HANDOFF_URL);
  }

  // Loop handoff: the assistant prefills its input from "pb-assistant-prompt";
  // "pb-assistant-mode" = "loop" additionally switches it to Loop mode.
  function handleStartLoop() {
    if (empty) return;
    try {
      sessionStorage.setItem("pb-assistant-prompt", xmlContent);
      sessionStorage.setItem("pb-assistant-mode", "loop");
    } catch {
      toast.error("Übergabe an den Assistenten nicht möglich (Browser-Speicher gesperrt).");
      return;
    }
    router.push("/assistant");
  }

  function handleTestInPlayground() {
    // The playground edits the same draft (builder store).
    router.push("/playground");
  }

  async function handleCopy() {
    if (await copyText(xmlContent)) toast.success("Kopiert");
    else toast.error("Kopieren nicht möglich.");
  }

  function handleInsertTag(tag: string) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = xmlContent.substring(start, end);
    const open = `<${tag}>`;
    setXmlContent(xmlContent.substring(0, start) + `${open}${selected}</${tag}>` + xmlContent.substring(end));
    // Keep editing where the tag went in: inside it, after the wrapped text.
    requestAnimationFrame(() => {
      textarea.focus();
      const caret = start + open.length + selected.length;
      textarea.setSelectionRange(caret, caret);
    });
  }

  function handleSyncBack() {
    const next = syncedStructured(xmlContent, structured);
    if (!next) {
      toast.error("Keine Prompt-Tags im XML gefunden – nichts übernommen.");
      return;
    }
    updateStructured(next);
    markXmlInSync(next);
    toast.success("XML in die Abschnitte übernommen.");
  }

  const emptyReason = empty ? "Erst einen Prompt aufbauen" : undefined;

  return (
    <section aria-labelledby="pb-step-title" className="space-y-4">
      <div className="flex flex-col gap-3">
        <div className="min-w-0">
          <h2 id="pb-step-title" className="text-lg font-semibold">
            Vorschau
          </h2>
          <p className="max-w-[70ch] text-ui text-muted-foreground">
            Das fertige XML. Du kannst es hier direkt bearbeiten; mit „In Abschnitte übernehmen“ landen die Änderungen
            wieder in den Feldern.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={handleRunInAssistant} disabledReason={emptyReason}>
            <SquareTerminal aria-hidden /> Im Assistent ausführen
          </Button>
          <Button variant="outline" onClick={handleTestInPlayground} disabledReason={emptyReason}>
            <FlaskConical aria-hidden /> Im Playground testen
          </Button>
          <Button
            // Remount when blocking changes: the reason and the tooltip are different tooltip modes.
            key={empty ? "blocked" : "ready"}
            variant="outline"
            onClick={handleStartLoop}
            disabledReason={emptyReason}
            tooltip="Startet den Prompt im Loop-Modus des Assistenten: Der Server wiederholt ihn, bis der Agent das Abschlusssignal ausgibt oder die maximale Zahl an Iterationen erreicht ist. Am besten mit einer Definition of Done und einer prüfbaren Prüfung (z. B. Tests) im Prompt."
          >
            <Repeat aria-hidden /> Als Loop im Assistent starten
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton aria-label="Weitere Aktionen für das XML" variant="ghost">
                <MoreHorizontal />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem disabled={empty} onSelect={() => void handleCopy()}>
                <Copy /> XML kopieren
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={empty} onSelect={handleSyncBack}>
                <Undo2 /> In Abschnitte übernehmen
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <XmlTagPalette onInsert={handleInsertTag} />

      <Field id={fieldDomId("xml")}>
        <FieldLabel>Prompt (XML)</FieldLabel>
        <Textarea
          ref={textareaRef}
          autosize={{ min: 16, max: 48 }}
          className="font-mono md:text-xs md:leading-5"
          value={xmlContent}
          onChange={(e) => setXmlContent(e.target.value)}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
        <FieldHint>Änderungen hier gelten für Vorschau, Verfeinern, Speichern und die Übergabe an den Assistenten.</FieldHint>
      </Field>

      <StepFooter>
        <Button variant="outline" size="lg" onClick={onBack}>
          <ArrowLeft aria-hidden /> Zurück
        </Button>
        {/* One primary per screen: here it is „Im Assistent ausführen". */}
        <Button variant="secondary" size="lg" onClick={onNext} disabledReason={emptyReason}>
          Weiter: Verfeinern <ArrowRight aria-hidden />
        </Button>
      </StepFooter>
    </section>
  );
}
