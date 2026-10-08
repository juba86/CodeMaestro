"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { FolderOpen, MoreHorizontal, Pencil, RotateCcw, Save, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { useBuilderStore } from "@/stores/builder-store";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { PageHeader } from "@/components/ui/page-header";
import { Button, IconButton } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { confirm } from "@/components/ui/confirm";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { modKeyLabel, useIsApple } from "@/components/layout/use-client-info";
import { ProjectInfoForm } from "./project-info-form";
import { CotSectionEditor } from "./cot-section-editor";
import { PromptPreview } from "./prompt-preview";
import { RefinementChat } from "./refinement-chat";
import { SavePromptDialog } from "./save-prompt-dialog";
import { LoadProjectDialog } from "./load-project-dialog";
import { BuilderStepper, type BuilderStep, type StepView } from "./builder-stepper";
import { BuilderRail } from "./builder-rail";
import { ScoreBadge, useQualityReport } from "./prompt-quality-panel";
import { describeIssue, fieldDomId, type LintField } from "./lint-labels";
import { clearXmlBasis, syncXmlFromFields } from "./draft-sync";

const STEP_ORDER: BuilderStep[] = ["form", "edit", "preview", "refine"];
const STEP_LABEL: Record<BuilderStep, string> = {
  form: "Projekt",
  edit: "Abschnitte",
  preview: "Vorschau",
  refine: "Verfeinern",
};

// Fields the section editor (step 2) shows as well as the project form.
const SECTION_FIELDS = new Set<LintField>(["instructions", "context", "constraints", "task"]);

function stepForField(field: LintField, current: BuilderStep): BuilderStep {
  if (field === "xml") return "preview";
  if (field === "examples") return "edit";
  return current === "edit" && SECTION_FIELDS.has(field) ? "edit" : "form";
}

const noop = () => () => {};

/**
 * The draft lives in localStorage (persisted store), which the server can't
 * see: render a placeholder until hydrated so server and client markup match.
 */
function useHydrated(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}

export function BuilderWorkflow() {
  const hydrated = useHydrated();
  const step = useBuilderStore((s) => s.step);
  const setStep = useBuilderStore((s) => s.setStep);
  const reset = useBuilderStore((s) => s.reset);
  const structured = useBuilderStore((s) => s.structured);
  const xmlContent = useBuilderStore((s) => s.xmlContent);
  const currentPromptId = useBuilderStore((s) => s.currentPromptId);
  const projectMeta = useBuilderStore((s) => s.projectMeta);
  const quality = useQualityReport();
  const isApple = useIsApple();

  const [saveOpen, setSaveOpen] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const pendingFocus = useRef<LintField | null>(null);
  const [focusTick, setFocusTick] = useState(0);

  const hasGoal = !!(structured.instructions.trim() || structured.task.trim());
  const canSave = hasGoal || !!xmlContent.trim();

  /**
   * Moves to a step. Leaving the form or the section editor for a later step
   * („Manuell aufbauen", „Weiter") rebuilds the XML from the fields when they
   * changed since it was built; unchanged fields keep it, including edits
   * made by hand in the preview. From the preview on, the XML is the source.
   */
  const goTo = useCallback(
    (target: BuilderStep) => {
      const s = useBuilderStore.getState();
      if (target === s.step) return;
      if ((s.step === "form" || s.step === "edit") && target !== "form") syncXmlFromFields();
      setStep(target);
    },
    [setStep],
  );

  // Leaving the builder from the fields: the playground, the library and the
  // assistant read the XML, so bring it up to date with the fields.
  useEffect(
    () => () => {
      const s = useBuilderStore.getState();
      if (s.step === "form" || s.step === "edit") syncXmlFromFields();
    },
    [],
  );

  const focusNow = useCallback(() => {
    const field = pendingFocus.current;
    if (!field) return;
    requestAnimationFrame(() => {
      const el = document.getElementById(fieldDomId(field));
      if (!el) return;
      pendingFocus.current = null;
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: "center", behavior: "auto" });
    });
  }, []);

  // „Zum Feld": open the step that shows the field, then focus it. From the
  // mobile sheet the focus moves once the sheet has closed (see onCloseAutoFocus).
  const focusField = useCallback(
    (field: LintField) => {
      pendingFocus.current = field;
      goTo(stepForField(field, useBuilderStore.getState().step));
      if (railOpen) setRailOpen(false);
      else setFocusTick((t) => t + 1);
    },
    [goTo, railOpen],
  );

  useEffect(() => {
    if (focusTick > 0) focusNow();
  }, [focusTick, focusNow]);

  function openSave() {
    if (!canSave) {
      toast.info("Erst ein Ziel angeben – dann lässt sich der Prompt speichern.");
      return;
    }
    // Save what the fields say: on the first two steps the XML follows the
    // fields (if they changed); on the preview and refine steps it is the source.
    const s = useBuilderStore.getState();
    if (s.step === "form" || s.step === "edit") syncXmlFromFields();
    setSaveOpen(true);
  }

  async function handleReset() {
    const ok = await confirm({
      title: "Alle Eingaben verwerfen?",
      description:
        "Ziel, Abschnitte, Beispiele, XML und der Verlauf der Verfeinerung werden gelöscht. Gespeicherte Prompts in der Bibliothek bleiben erhalten.",
      confirmLabel: "Verwerfen",
      tone: "danger",
    });
    if (!ok) return;
    reset();
    clearXmlBasis();
  }

  useHotkeys(
    { "mod+s": () => openSave() },
    { allowInInputs: ["mod+s"], enabled: hydrated },
  );

  const steps: StepView[] = useMemo(() => {
    const currentIdx = STEP_ORDER.indexOf(step);
    const errors = quality.empty ? [] : quality.report.issues.filter((i) => i.severity === "error");
    return STEP_ORDER.map((id, idx) => {
      const err = errors.find((e) => {
        const f = describeIssue(e).field ?? "instructions";
        return (f === "xml" ? "preview" : f === "examples" ? "edit" : "form") === id;
      });
      const locked = id !== "form" && id !== step && !hasGoal;
      return {
        id,
        label: STEP_LABEL[id],
        current: id === step,
        status: err ? "invalid" : id === step ? "current" : idx < currentIdx ? "complete" : "upcoming",
        reason: err ? describeIssue(err).title : undefined,
        lockedReason: locked ? "Erst ein Ziel angeben" : undefined,
      };
    });
  }, [step, quality, hasGoal]);

  const saveKbd = isApple === null ? undefined : modKeyLabel(isApple, "S");

  return (
    <div className="mx-auto w-full max-w-[1200px]">
      <PageHeader
        title="Builder"
        description="Prompts Schritt für Schritt aufbauen, für dein Modell prüfen und mit KI verfeinern."
        actions={
          <>
            <Button
              variant="outline"
              className="min-w-0 flex-1 md:flex-none xl:hidden"
              onClick={() => setRailOpen(true)}
              aria-haspopup="dialog"
            >
              <SlidersHorizontal aria-hidden />
              Technik & Qualität
              {hydrated && !quality.empty ? <ScoreBadge report={quality.report} className="-mr-1" /> : null}
            </Button>
            <Button variant="ghost" className="hidden lg:inline-flex" onClick={() => setLoadOpen(true)}>
              <FolderOpen aria-hidden /> Projekt laden
            </Button>
            <Button variant="ghost" className="hidden lg:inline-flex" onClick={handleReset}>
              <RotateCcw aria-hidden /> Zurücksetzen
            </Button>
            <Button
              variant="outline"
              className="hidden md:inline-flex"
              onClick={openSave}
              kbd={saveKbd}
              disabledReason={hydrated && !canSave ? "Erst ein Ziel angeben" : undefined}
            >
              <Save aria-hidden /> Speichern
            </Button>
            <IconButton
              aria-label="Speichern"
              variant="outline"
              className="md:hidden"
              onClick={openSave}
              disabledReason={hydrated && !canSave ? "Erst ein Ziel angeben" : undefined}
            >
              <Save />
            </IconButton>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton aria-label="Weitere Aktionen" variant="ghost" className="lg:hidden">
                  <MoreHorizontal />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => setLoadOpen(true)}>
                  <FolderOpen /> Projekt laden
                </DropdownMenuItem>
                <DropdownMenuItem variant="danger" onSelect={() => void handleReset()}>
                  <RotateCcw /> Zurücksetzen
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      {!hydrated ? (
        <div className="space-y-4" aria-busy="true">
          <span className="sr-only">Builder wird geladen …</span>
          <Skeleton className="h-10 w-full max-w-xl" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <>
          {currentPromptId ? (
            <p className="-mt-1 mb-4 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
              <Pencil aria-hidden className="size-3.5 text-primary-text" />
              Bearbeitet das gespeicherte Projekt
              <span className="font-medium text-foreground">„{projectMeta?.title || "ohne Titel"}“</span>– Speichern legt
              eine neue Version an.
            </p>
          ) : null}

          <div className="mb-6 border-b border-border pb-3">
            <BuilderStepper steps={steps} onSelect={goTo} />
          </div>

          <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0">
              {step === "form" && <ProjectInfoForm onNext={() => goTo("edit")} />}
              {step === "edit" && <CotSectionEditor onBack={() => goTo("form")} onNext={() => goTo("preview")} />}
              {step === "preview" && (
                <PromptPreview onBack={() => goTo("edit")} onNext={() => goTo("refine")} />
              )}
              {step === "refine" && <RefinementChat onBack={() => goTo("preview")} />}
            </div>
            <aside aria-label="Technik und Qualität" className="hidden xl:block">
              <div className="sticky top-0 -mt-1 max-h-[calc(100dvh-3rem)] overflow-y-auto pb-2 pt-1">
                <BuilderRail quality={quality} onFocusField={focusField} />
              </div>
            </aside>
          </div>
        </>
      )}

      <Sheet open={railOpen} onOpenChange={setRailOpen}>
        <SheetContent
          side="auto"
          onCloseAutoFocus={(e) => {
            if (!pendingFocus.current) return;
            e.preventDefault();
            focusNow();
          }}
        >
          <SheetHeader>
            <SheetTitle>Technik & Qualität</SheetTitle>
            <SheetDescription>Passende Techniken, Prüfergebnis und erweiterte Einstellungen.</SheetDescription>
          </SheetHeader>
          <SheetBody>
            <BuilderRail quality={quality} onFocusField={focusField} className="pb-2" />
          </SheetBody>
        </SheetContent>
      </Sheet>

      <SavePromptDialog open={saveOpen} onClose={() => setSaveOpen(false)} />
      <LoadProjectDialog open={loadOpen} onClose={() => setLoadOpen(false)} />
    </div>
  );
}
