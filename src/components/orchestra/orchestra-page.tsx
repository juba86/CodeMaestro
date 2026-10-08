"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useActivity } from "@/hooks/use-activity";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { useIsMobile, useMediaQuery } from "@/hooks/use-media-query";
import { useNow } from "@/hooks/use-now";
import { useShellChrome } from "@/hooks/use-shell-chrome";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { cn } from "@/components/ui/cn";
import { ProviderDot, providerTone } from "@/components/ui/provider-mark";
import { OrchestraPageProvider, type OrchestraPageContextValue } from "./context";
import { findWorker, workerParts } from "./derive";
import { CONDUCTOR_TARGET, findRole } from "./edit";
import { InspectorPanel, InspectorSheet } from "./inspector";
import { deriveLiveView } from "./live";
import { MobileOrchestra, MobileSkeleton, mobileRowId } from "./mobile";
import { pickerItems } from "./model-items";
import { ModelPalette, NoModelsState, PROVIDERS_HREF } from "./model-palette";
import { CONDUCTOR_MAIN_ID, CanvasSkeleton, OrgCanvas, roleCardId, roleMainId } from "./org-canvas";
import type { OrchestraProblem, OrchestraProblemFix } from "./problems";
import { LiveBanner, PresetControl, PresetNote, PresetWarnings, ProblemsBadge, SaveButton } from "./toolbar";
import { useDragAssign, type DragPayload, type DropVerdict } from "./use-drag-assign";
import { useOrchestraEditor } from "./use-orchestra-editor";
import { useOrchestraLive } from "./use-orchestra-live";

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The /orchestra page: the interactive org chart „Welches Modell spielt welche Rolle?" (§6.3). */
export function OrchestraPage() {
  // Mobile: own AppBar (the shell's is hidden); the TabBar stays.
  useShellChrome({ appBar: false });
  const router = useRouter();
  const editor = useOrchestraEditor();
  const isMobile = useIsMobile();
  const wide = useMediaQuery("(min-width: 1280px)");
  const showPalette = useMediaQuery("(min-width: 1024px)");
  const layout = isMobile ? "mobile" : "desktop";

  const [pickerFor, setPickerFor] = React.useState<string | null>(null);
  const [addOpen, setAddOpen] = React.useState<OrchestraPageContextValue["addOpen"]>(null);
  const [editorFor, setEditorFor] = React.useState<string | null>(null);
  const [problemsOpen, setProblemsOpen] = React.useState(false);

  // --- Live (read-only follower of an orchestrate run) ---
  const activity = useActivity();
  const runs = React.useMemo(() => activity.runs.filter((r) => r.kind === "orchestrate"), [activity.runs]);
  const [follow, setFollow] = React.useState<{ sessionId: string; title: string } | null>(null);
  const { live, connection } = useOrchestraLive(follow?.sessionId ?? null);
  const now = useNow(live.active ? 1000 : 60_000);
  const liveView = React.useMemo(
    () => (follow ? deriveLiveView(live, editor.draft, now) : null),
    [follow, live, editor.draft, now],
  );
  const runningSince = runs.length ? Math.min(...runs.map((r) => r.startedAt)) : null;

  const readOnly = !!editor.configError && !editor.draft;
  const items = React.useMemo(() => pickerItems(editor.workers), [editor.workers]);

  // --- Drag and drop ---
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const verdict = React.useCallback(
    (p: DragPayload, key: string): DropVerdict | null => {
      const draft = editor.draft;
      if (!draft) return null;
      if (key === "palette") return typeof p.from === "object" ? { valid: true } : null;
      const target = key === "conductor" ? CONDUCTOR_TARGET : key.startsWith("role:") ? key.slice(5) : null;
      if (!target) return null;
      if (typeof p.from === "object" && p.from.target === target) return null;
      if (target === CONDUCTOR_TARGET) return { valid: true };
      const role = findRole(draft, target);
      if (!role) return null;
      const w = findWorker(editor.workers, p.workerId);
      if (role.editsFiles && w && !w.editsFiles) return { valid: false, reason: "Kann keine Dateien ändern" };
      return { valid: true };
    },
    [editor.draft, editor.workers],
  );
  const { assign, announce, labelOf } = editor;
  const { dragging, over, ghostRef, startProps, consumeClick } = useDragAssign({
    verdict,
    scrollRef,
    onDrop: React.useCallback(
      (p: DragPayload, key: string) => {
        if (key === "palette") {
          if (typeof p.from === "object") assign(p.from.target, "");
          return;
        }
        assign(key === "conductor" ? CONDUCTOR_TARGET : key.slice(5), p.workerId);
      },
      [assign],
    ),
    onStart: React.useCallback(
      (p: DragPayload) => announce(`${labelOf(p.workerId)} aufgenommen. Auf eine Rolle ziehen, Esc bricht ab.`),
      [announce, labelOf],
    ),
    onCancel: React.useCallback(() => announce("Ziehen beendet – nichts geändert."), [announce]),
  });

  // --- Navigation helpers ---
  const reveal = React.useCallback(
    (target: string, { focus = true }: { focus?: boolean } = {}) => {
      if (isMobile) {
        setProblemsOpen(false);
        requestAnimationFrame(() => {
          const row = document.getElementById(mobileRowId(target));
          row?.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
          if (focus) row?.querySelector<HTMLElement>("[data-row-main]")?.focus({ preventScroll: true });
        });
        return;
      }
      editor.select(target === CONDUCTOR_TARGET ? { kind: "conductor" } : { kind: "role", id: target });
      if (!wide) return; // the inspector sheet opens and takes focus
      setProblemsOpen(false);
      requestAnimationFrame(() => {
        const card = document.getElementById(target === CONDUCTOR_TARGET ? CONDUCTOR_MAIN_ID : roleCardId(target));
        card?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
        if (focus) document.getElementById(target === CONDUCTOR_TARGET ? CONDUCTOR_MAIN_ID : roleMainId(target))?.focus({ preventScroll: true });
      });
    },
    [editor, isMobile, wide],
  );

  const jumpToFirstProblem = React.useCallback(() => {
    const first =
      editor.problems.find((p) => p.severity === "error") ?? editor.problems.find((p) => p.severity === "warning");
    if (!first) return;
    const target = first.conductor ? CONDUCTOR_TARGET : first.roleId;
    if (isMobile || !target) {
      editor.select(null);
      if (wide && !isMobile) {
        requestAnimationFrame(() => document.getElementById("orchestra-checks-list")?.focus());
      } else {
        setProblemsOpen(true);
      }
      return;
    }
    reveal(target);
  }, [editor, isMobile, wide, reveal]);

  const runFix = React.useCallback(
    (problem: OrchestraProblem, fix: OrchestraProblemFix) => {
      const target = problem.conductor ? CONDUCTOR_TARGET : problem.roleId;
      switch (fix.intent) {
        case "providers":
          router.push(PROVIDERS_HREF);
          return;
        case "add-role":
          setProblemsOpen(false);
          editor.select(null);
          setAddOpen(isMobile ? "any" : "build");
          return;
        case "pick-model":
          if (!target) return;
          setProblemsOpen(false);
          if (isMobile) {
            setEditorFor(null);
            requestAnimationFrame(() => setPickerFor(`slot:${target}`));
          } else {
            editor.select(target === CONDUCTOR_TARGET ? { kind: "conductor" } : { kind: "role", id: target });
            requestAnimationFrame(() => setPickerFor(`inspector:${target}`));
          }
          return;
        case "rename":
          if (!target || target === CONDUCTOR_TARGET) return;
          // The name field focuses itself while renamingId points at the role.
          editor.setRenamingId(target);
          setProblemsOpen(false);
          if (isMobile) {
            setEditorFor(target);
          } else if (wide) {
            reveal(target, { focus: false });
          } else {
            // Rename inline on the card (the sheet closes without taking focus back).
            requestAnimationFrame(() =>
              document.getElementById(roleCardId(target))?.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" }),
            );
          }
          return;
        default:
          editor.applyFix(fix);
      }
    },
    [editor, isMobile, wide, reveal, router],
  );

  // ⌘S / Ctrl+S saves, also from text fields (never while a confirm dialog asks).
  useHotkeys(
    {
      "mod+s": () => {
        if (document.querySelector('[role="alertdialog"]')) return;
        void editor.save();
      },
    },
    { allowInInputs: ["mod+s"], allowInDialogs: true, enabled: editor.ready },
  );

  const ctx: OrchestraPageContextValue = {
    editor,
    items,
    live: liveView,
    readOnly,
    layout,
    wide,
    drag: { dragging, over, startProps, consumeClick },
    pickerFor,
    setPickerFor,
    addOpen,
    setAddOpen,
    editorFor,
    setEditorFor,
    problemsOpen,
    setProblemsOpen,
    runFix,
    reveal,
    runningSince,
  };

  const banner = (
    <LiveBanner
      runs={runs}
      follow={follow}
      onFollow={(f) => {
        setFollow(f);
        announce(f ? `Live-Ansicht: „${f.title}“.` : "Live-Ansicht geschlossen.");
      }}
      connection={connection}
      compact={isMobile}
    />
  );

  const status = editor.configError && !editor.draft ? (
    <Callout
      variant="danger"
      title="Orchester konnte nicht geladen werden"
      action={
        <Button size="sm" variant="outline" onClick={() => void editor.reload()}>
          Erneut versuchen
        </Button>
      }
    >
      {editor.configError} Bearbeiten ist erst wieder möglich, wenn die Konfiguration geladen ist.
    </Callout>
  ) : !editor.ready ? (
    <>
      <span className="sr-only" role="status">
        Orchester wird geladen …
      </span>
      {isMobile ? <MobileSkeleton /> : <CanvasSkeleton />}
    </>
  ) : null;

  const draggedWorker = dragging ? findWorker(editor.workers, dragging.workerId) : null;
  const ghostParts = draggedWorker ? workerParts(draggedWorker) : null;

  return (
    <OrchestraPageProvider value={ctx}>
      {layout === "mobile" ? (
        <MobileOrchestra banner={banner} onJump={jumpToFirstProblem} status={status} />
      ) : (
        <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col bg-background">
          <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
            <h1 className="text-sm font-semibold text-foreground">Orchester</h1>
            <p className="hidden min-w-0 truncate text-xs text-muted-foreground lg:block">Welches Modell spielt welche Rolle?</p>
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              <ProblemsBadge onJump={jumpToFirstProblem} />
              {editor.dirty ? (
                <Button variant="ghost" size="sm" onClick={() => void editor.discard()}>
                  Verwerfen
                </Button>
              ) : null}
              <SaveButton />
            </div>
          </header>
          <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-surface px-4 py-2.5">
            <PresetControl />
            <PresetNote className="max-w-[28rem]" />
            <div className="ml-auto flex min-w-0 max-w-full justify-end">{banner}</div>
          </div>
          {editor.presetWarnings?.length ? (
            <div className="shrink-0 border-b border-border px-4 py-2.5">
              <PresetWarnings />
            </div>
          ) : null}
          <div className="relative flex min-h-0 flex-1">
            {showPalette && !(editor.configError && !editor.draft) ? <ModelPalette /> : null}
            <div ref={scrollRef} className="canvas-grid min-w-0 flex-1 overflow-auto">
              {status ? (
                <div className={cn(editor.configError ? "mx-auto max-w-xl p-6" : undefined)}>{status}</div>
              ) : (
                <>
                  {/* Without the palette (below 1024) the empty state sits above the chart. */}
                  {!showPalette && editor.workers?.length === 0 ? (
                    <NoModelsState className="mx-auto mt-6 max-w-md rounded-lg border border-border bg-card py-6" />
                  ) : null}
                  <OrgCanvas />
                </>
              )}
            </div>
            {wide && editor.draft ? <InspectorPanel /> : null}
          </div>
          {!wide && editor.draft ? <InspectorSheet /> : null}
        </div>
      )}
      <p aria-live="polite" className="sr-only">
        <span key={editor.announcement.n}>{editor.announcement.text}</span>
      </p>
      {dragging && ghostParts && draggedWorker ? (
        <div
          ref={ghostRef}
          aria-hidden
          className="pointer-events-none fixed left-0 top-0 z-50 flex max-w-64 items-center gap-2 rounded-md border border-primary-border bg-popover px-2 py-1.5 text-ui text-foreground shadow-md"
          style={{ transform: "translate3d(-9999px, -9999px, 0)" }}
        >
          <ProviderDot tone={providerTone(draggedWorker.kind)} />
          <span className="truncate font-medium">{ghostParts.name}</span>
          {ghostParts.detail ? <span className="truncate text-muted-foreground">{ghostParts.detail}</span> : null}
        </div>
      ) : null}
    </OrchestraPageProvider>
  );
}
