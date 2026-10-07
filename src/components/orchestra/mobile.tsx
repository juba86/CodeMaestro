"use client";

import * as React from "react";
import { AudioWaveform, ChevronRight, CircleAlert, Plus, Sparkles, TriangleAlert } from "lucide-react";
import { ORCHESTRA_LIMITS, type OrchestraRole } from "@/lib/assistant/orchestra-types";
import { AppBar } from "@/components/ui/app-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { ModelPicker } from "@/components/ui/model-picker";
import { ProviderDot, providerTone } from "@/components/ui/provider-mark";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { formatClock } from "@/lib/format";
import { AddRoleList, LIMIT_REASON } from "./add-role";
import { useOrchestraPage } from "./context";
import {
  COLUMN_LABEL,
  ORCHESTRA_COLUMNS,
  conductorAssignment,
  roleAssignment,
  rolesByColumn,
  workerLabel,
  workerShortLabel,
  type AssignmentView,
  type OrchestraColumn,
} from "./derive";
import { CONDUCTOR_TARGET } from "./edit";
import { InspectorSheet } from "./inspector";
import { capabilityFilter, capabilityHint, hiddenTextModels, pickerTitle } from "./model-items";
import { NoModelsState } from "./model-palette";
import { COLUMN_ICON } from "./org-canvas";
import { LiveBadge } from "./orchestra-live-list";
import { problemsFor } from "./problems";
import { PresetControl, PresetNote, PresetWarnings, ProblemsBadge, SaveButton } from "./toolbar";

export const mobileRowId = (target: string) => `orchestra-row-${target === CONDUCTOR_TARGET ? "dirigent" : target}`;

const STRETCHED = "min-w-0 truncate text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none";
const ROW_FOCUS =
  "has-[[data-row-main]:focus-visible]:outline-2 has-[[data-row-main]:focus-visible]:-outline-offset-2 has-[[data-row-main]:focus-visible]:outline-ring";

/** ModelPicker sheet „Modell für ‚Tester‘" around a custom trigger (tap the model line). */
function ModelSheet({ target, role, children }: { target: string; role: OrchestraRole | null; children: React.ReactElement }) {
  const { editor, items, pickerFor, setPickerFor, readOnly } = useOrchestraPage();
  const draft = editor.draft!;
  const a = role ? roleAssignment(role, draft, editor.workers) : conductorAssignment(draft, editor.workers);
  const auto = role
    ? roleAssignment({ ...role, workerId: "" }, draft, editor.workers)
    : conductorAssignment({ conductor: { ...draft.conductor, workerId: "" } }, editor.workers);
  const key = `slot:${target}`;
  const name = role ? role.name.trim() || role.id : "Dirigent";
  return (
    <ModelPicker
      presentation="sheet"
      items={items}
      value={a.configuredId}
      onValueChange={(id) => editor.assign(target, id)}
      filter={capabilityFilter(role)}
      title={role ? pickerTitle(name) : "Modell für den Dirigenten"}
      hint={capabilityHint(role)}
      allowAuto
      autoSublabel={auto.worker ? workerLabel(auto.worker) : undefined}
      hiddenLabel={hiddenTextModels}
      revealedSelectable
      open={pickerFor === key}
      onOpenChange={(o) => setPickerFor(o ? key : null)}
      disabled={readOnly}
    >
      {children}
    </ModelPicker>
  );
}

function ModelLine({ a, capability, suffix }: { a: AssignmentView; capability: "configured" | "auto" | null; suffix?: string }) {
  if (capability && a.worker) {
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-danger">
        <CircleAlert aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate">
          {capability === "auto" ? "Kein Modell mit Dateizugriff verfügbar" : `${workerShortLabel(a.worker)} kann keine Dateien ändern`}
        </span>
      </span>
    );
  }
  if (a.unavailable) {
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-warning">
        <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate">‚{a.configuredId}‘ nicht verfügbar</span>
      </span>
    );
  }
  if (a.auto) {
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <Sparkles aria-hidden className="size-3.5 shrink-0 text-subtle-foreground" />
        <span className="truncate">
          Automatisch{a.worker ? ` · ${workerLabel(a.worker)}` : ""}
          {suffix ? ` · ${suffix}` : ""}
        </span>
      </span>
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {a.worker ? <ProviderDot tone={providerTone(a.worker.kind)} /> : null}
      <span className="truncate">
        {a.label}
        {suffix ? ` · ${suffix}` : ""}
      </span>
    </span>
  );
}

function RoleRow({ role, column }: { role: OrchestraRole; column: OrchestraColumn }) {
  const { editor, live, setEditorFor, readOnly } = useOrchestraPage();
  const draft = editor.draft!;
  const a = roleAssignment(role, draft, editor.workers);
  const lv = live?.roles[role.id];
  const problems = problemsFor(editor.problems, role.id);
  const cap = problems.find((p) => p.capability && p.severity !== "info");
  const warnings = problems.filter((p) => p.severity !== "info" && !p.capability);
  const name = role.name.trim() || "Ohne Namen";
  const reviews =
    column === "review"
      ? `prüft ${draft.roles
          .filter((r) => r.id !== role.id && r.enabled && r.reviewLoop.enabled && r.reviewLoop.reviewerRoleId === role.id)
          .map((r) => r.name.trim() || r.id)
          .join(", ")}`
      : undefined;
  return (
    <li
      id={mobileRowId(role.id)}
      className={cn(
        "relative flex min-h-14 items-center gap-3 px-3 py-2",
        ROW_FOCUS,
        lv?.active && "bg-primary-subtle",
        !role.enabled && "bg-surface-2/60",
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            data-row-main
            onClick={() => setEditorFor(role.id)}
            aria-label={`${name} bearbeiten`}
            className={cn(STRETCHED, "text-[15px] font-medium leading-6", role.enabled ? "text-foreground" : "text-muted-foreground")}
          >
            {name}
          </button>
          {lv ? <LiveBadge label={lv.label} tone={lv.tone} active={lv.active} /> : !role.enabled ? <Badge>aus</Badge> : null}
          {warnings.length ? (
            <span className="relative shrink-0">
              <span aria-hidden className="block size-2 rounded-full bg-warning" />
              <span className="sr-only">
                {warnings.length === 1 ? "1 Hinweis" : `${warnings.length} Hinweise`}: {warnings.map((w) => w.message).join(" ")}
              </span>
            </span>
          ) : null}
        </p>
        <ModelSheet target={role.id} role={role}>
          <button
            type="button"
            disabled={readOnly}
            aria-label={`Modell für ${name}: ${a.label}. Ändern`}
            // The model line spans the row and its touch area grows to 40px into the row padding (§7).
            className="relative z-10 -mx-1 mt-0.5 flex min-h-7 w-[calc(100%+0.5rem)] items-center rounded-sm px-1 text-left text-ui text-muted-foreground before:absolute before:inset-x-0 before:-bottom-2 before:-top-1 before:content-[''] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
          >
            <ModelLine a={a} capability={cap ? (cap.id.startsWith("no-file-worker") ? "auto" : "configured") : null} suffix={reviews} />
          </button>
        </ModelSheet>
      </div>
      <ChevronRight aria-hidden className="size-5 shrink-0 text-subtle-foreground" />
    </li>
  );
}

function ConductorCardMobile() {
  const { editor, live, setEditorFor, readOnly } = useOrchestraPage();
  const draft = editor.draft!;
  const a = conductorAssignment(draft, editor.workers);
  const cv = live?.conductor;
  return (
    <article
      id={mobileRowId(CONDUCTOR_TARGET)}
      className={cn("rounded-xl border border-primary-border bg-card p-3 shadow-sm", cv?.active && "bg-linear-to-b from-primary-subtle to-primary-subtle")}
    >
      <div className={cn("relative flex items-center gap-2.5 rounded-md", ROW_FOCUS)}>
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-subtle text-primary-text [&_svg]:size-5">
          <AudioWaveform />
        </span>
        <div className="min-w-0 flex-1">
          {/* The live badge shares the title line so the description keeps the full width. */}
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              data-row-main
              onClick={() => setEditorFor(CONDUCTOR_TARGET)}
              aria-label="Dirigent bearbeiten"
              className={cn(STRETCHED, "text-[15px] font-semibold leading-6 text-foreground")}
            >
              Dirigent
            </button>
            {cv && cv.phase !== "idle" ? (
              <span className="ml-auto shrink-0">
                <LiveBadge label={cv.label} tone={cv.tone} active={cv.active} />
              </span>
            ) : null}
          </div>
          <p className="truncate text-sm text-muted-foreground">plant, verteilt, fasst zusammen</p>
        </div>
      </div>
      <ModelSheet target={CONDUCTOR_TARGET} role={null}>
        <button
          type="button"
          disabled={readOnly}
          aria-label={`Modell des Dirigenten: ${a.label}. Ändern`}
          className={cn(
            "mt-3 flex h-11 w-full min-w-0 items-center gap-2 rounded-md border bg-background px-3 text-left text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            a.auto ? "border-dashed border-border-strong" : a.unavailable ? "border-warning-border" : "border-border-strong",
          )}
        >
          <span className="min-w-0 flex-1 truncate">
            <ModelLine a={a} capability={null} />
          </span>
          <ChevronRight aria-hidden className="size-5 shrink-0 text-subtle-foreground" />
        </button>
      </ModelSheet>
    </article>
  );
}

function AddRoleSheet() {
  const { editor, addOpen, setAddOpen, setEditorFor } = useOrchestraPage();
  const picked = React.useRef(false);
  return (
    <Sheet open={addOpen === "any"} onOpenChange={(o) => setAddOpen(o ? "any" : null)}>
      <SheetContent
        side="bottom"
        onCloseAutoFocus={(e) => {
          // The role editor opens next and takes focus.
          if (picked.current) e.preventDefault();
          picked.current = false;
        }}
      >
        <SheetHeader>
          <SheetTitle>Rolle hinzufügen</SheetTitle>
          <SheetDescription>Vorschläge mit passenden Voreinstellungen – oder eine eigene Rolle.</SheetDescription>
        </SheetHeader>
        <SheetBody className="px-2">
          <AddRoleList
            column={null}
            size="lg"
            onPick={(t) => {
              const id = editor.addRole(t);
              setAddOpen(null);
              if (id) {
                picked.current = true;
                editor.setRenamingId(id);
                setEditorFor(id);
              }
            }}
          />
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

/** Phone layout (§6.3.4): own AppBar, presets, Dirigent card and the columns as lists along a spine. */
export function MobileOrchestra({
  banner,
  onJump,
  status,
}: {
  banner: React.ReactNode;
  onJump: () => void;
  /** Loading skeleton / error callout instead of the chart. */
  status: React.ReactNode;
}) {
  const { editor, live, readOnly, setAddOpen, runningSince } = useOrchestraPage();
  const draft = editor.draft;
  const cols = draft ? rolesByColumn(draft) : null;
  const atLimit = (draft?.roles.length ?? 0) >= ORCHESTRA_LIMITS.roles;
  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col bg-background">
      <AppBar
        titleAs="h1"
        title="Orchester"
        actions={
          <>
            <ProblemsBadge compact onJump={onJump} />
            <SaveButton size="md" showKbd={false} />
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="space-y-2 border-b border-border bg-surface px-4 py-2.5">
          <div className="-mx-4 overflow-x-auto px-4 scrollbar-none">
            <PresetControl className="w-max" />
          </div>
          <PresetNote />
          {banner}
          <PresetWarnings />
        </div>
        <div className="canvas-grid min-h-full space-y-4 px-4 pb-8 pt-4">
          {status ??
            (draft && cols ? (
              <>
                {editor.workers && editor.workers.length === 0 ? (
                  <NoModelsState className="rounded-lg border border-border bg-card py-6" />
                ) : null}
                <ConductorCardMobile />
                <div className="ml-4 space-y-4 border-l-2 border-border-strong pl-4">
                  {ORCHESTRA_COLUMNS.map((c) => {
                    const Icon = COLUMN_ICON[c];
                    const working = !!live?.workingColumns.includes(c);
                    return (
                      <section key={c} aria-labelledby={`m-col-${c}`}>
                        <h2
                          id={`m-col-${c}`}
                          className={cn("mb-2 flex items-center gap-1.5 text-sm font-semibold", working ? "text-primary-text" : "text-muted-foreground")}
                        >
                          <Icon aria-hidden className="size-4" />
                          {COLUMN_LABEL[c]}
                          <span className="font-normal text-subtle-foreground">
                            <span className="sr-only">, </span>
                            {cols[c].length}
                            <span className="sr-only"> {cols[c].length === 1 ? "Rolle" : "Rollen"}</span>
                          </span>
                        </h2>
                        {cols[c].length ? (
                          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                            {cols[c].map((role) => (
                              <RoleRow key={role.id} role={role} column={c} />
                            ))}
                          </ul>
                        ) : (
                          <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-subtle-foreground">
                            {c === "review" ? "Noch keine Prüfschleife." : "Keine Rolle."}
                          </p>
                        )}
                      </section>
                    );
                  })}
                  <Button
                    id="add-role-any"
                    variant="ghost"
                    size="lg"
                    disabled={readOnly}
                    disabledReason={atLimit ? LIMIT_REASON : undefined}
                    onClick={() => setAddOpen("any")}
                    className="w-full border border-dashed border-border-strong text-muted-foreground"
                  >
                    <Plus />
                    Rolle hinzufügen
                  </Button>
                </div>
                <p className="text-center text-xs text-subtle-foreground">
                  Änderungen gelten ab dem nächsten Lauf.
                  {runningSince ? ` Der laufende Lauf nutzt die Besetzung von ${formatClock(runningSince)}.` : ""}
                </p>
              </>
            ) : null)}
        </div>
      </div>
      {draft ? (
        <>
          <InspectorSheet mobile />
          <AddRoleSheet />
        </>
      ) : null}
    </div>
  );
}

export function MobileSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="rounded-xl border border-border bg-card p-3">
        <div className="flex items-center gap-2.5">
          <Skeleton className="size-9 rounded-lg" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3.5 w-44" />
          </div>
        </div>
        <Skeleton className="mt-3 h-11 w-full" />
      </div>
      <div className="ml-4 space-y-4 border-l-2 border-border-strong pl-4">
        {[2, 2, 1].map((n, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-20" />
            <div className="divide-y divide-border rounded-lg border border-border bg-card">
              {Array.from({ length: n }, (_, j) => (
                <div key={j} className="space-y-1.5 px-3 py-2.5">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3.5 w-40" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
