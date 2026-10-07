"use client";

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  AudioWaveform,
  CircleAlert,
  CircleCheck,
  Copy,
  Info,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { ORCHESTRA_LIMITS, type OrchestraRole } from "@/lib/assistant/orchestra-types";
import { Button, IconButton } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Field, FieldError, FieldHint, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ModelPicker } from "@/components/ui/model-picker";
import { SegmentedControl, SegmentedItem } from "@/components/ui/segmented-control";
import { SimpleSelect } from "@/components/ui/select";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SwitchRow } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useOrchestraPage } from "./context";
import { COLUMN_LABEL, columnOf, conductorAssignment, roleAssignment, workerLabel } from "./derive";
import { RoleIcon } from "./role-chip";
import { CONDUCTOR_TARGET, canMoveRole, findRole, setReviewLoop, validateRoleName } from "./edit";
import { capabilityFilter, capabilityHint, hiddenTextModels, pickerTitle } from "./model-items";
import { problemsFor, type OrchestraProblem } from "./problems";

const SEVERITY_ICON = { error: CircleAlert, warning: TriangleAlert, info: Info } as const;
const SEVERITY_TONE = {
  error: "border-danger-border bg-danger-subtle [&_[data-icon]]:text-danger",
  warning: "border-warning-border bg-warning-subtle [&_[data-icon]]:text-warning",
  info: "border-border bg-card [&_[data-icon]]:text-info",
} as const;

/** One problem with its fix buttons; `showTarget` names the role it concerns. */
export function ProblemItem({ problem, showTarget = true }: { problem: OrchestraProblem; showTarget?: boolean }) {
  const { editor, runFix, reveal, readOnly, layout } = useOrchestraPage();
  const Icon = SEVERITY_ICON[problem.severity];
  // Phones: 40px fix buttons (§7).
  const fixSize = layout === "mobile" ? "md" : "sm";
  const target = problem.conductor ? CONDUCTOR_TARGET : problem.roleId;
  const role = problem.roleId ? findRole(editor.draft!, problem.roleId) : undefined;
  const targetName = problem.conductor ? "Dirigent" : role ? role.name.trim() || role.id : null;
  return (
    <div className={cn("rounded-md border p-2.5 text-xs", SEVERITY_TONE[problem.severity])}>
      <div className="flex items-start gap-1.5">
        <Icon data-icon aria-hidden className="mt-px size-3.5 shrink-0" />
        <div className="min-w-0 flex-1 space-y-0.5">
          {showTarget && targetName && target ? (
            <button
              type="button"
              onClick={() => reveal(target, { focus: true })}
              className="-my-1 inline-flex min-h-6 items-center rounded-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {targetName}
            </button>
          ) : null}
          <p className="text-foreground">
            <span className="sr-only">{problem.severity === "error" ? "Problem: " : problem.severity === "warning" ? "Hinweis: " : "Info: "}</span>
            {problem.message}
          </p>
        </div>
      </div>
      {problem.fixes.length && !readOnly ? (
        <div className="mt-2 flex flex-wrap gap-1.5 pl-5">
          {problem.fixes.map((fix, i) => (
            <Button key={fix.label} size={fixSize} variant={i === 0 ? "outline" : "ghost"} onClick={() => runFix(problem, fix)}>
              {fix.label}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** „Prüfung": every problem with its fixes; infos folded away (§6.3.7). */
export function ProblemList({ headingId }: { headingId?: string }) {
  const { editor } = useOrchestraPage();
  const main = editor.problems.filter((p) => p.severity !== "info");
  const infos = editor.problems.filter((p) => p.severity === "info");
  return (
    <div className="space-y-3">
      {main.length ? (
        <ul className="space-y-2" aria-labelledby={headingId}>
          {main.map((p) => (
            <li key={p.id}>
              <ProblemItem problem={p} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-2 text-ui text-success">
          <CircleCheck aria-hidden className="size-4" />
          Alles in Ordnung.
        </p>
      )}
      {infos.length ? (
        <details className="group rounded-md border border-border bg-card">
          <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
            <Info aria-hidden className="size-3.5" />
            {infos.length === 1 ? "1 Hinweis ohne Handlungsbedarf" : `${infos.length} Hinweise ohne Handlungsbedarf`}
          </summary>
          <ul className="space-y-1.5 px-2.5 pb-2.5">
            {infos.map((p) => (
              <li key={p.id}>
                <ProblemItem problem={p} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function NameField({ role, takeRenameFocus }: { role: OrchestraRole; takeRenameFocus: boolean }) {
  const { editor, readOnly } = useOrchestraPage();
  const [value, setValue] = React.useState(role.name);
  const [error, setError] = React.useState<string | null>(null);
  // A name problem that is already in the draft (e.g. a duplicate) shows until fixed.
  const existing = editor.problems.find((p) => p.roleId === role.id && p.field === "name")?.message ?? null;
  const shown = error ?? (value === role.name ? existing : null);
  const commit = () => {
    const problem = validateRoleName(editor.draft!, role.id, value);
    if (problem) {
      editor.announce(`Name nicht übernommen: ${problem}.`);
      setValue(role.name);
      setError(null);
      return;
    }
    editor.rename(role.id, value);
  };
  return (
    <Field invalid={!!shown}>
      <FieldLabel>Name</FieldLabel>
      <Input
        data-role-name-field
        // Rename requested (new role, „Umbenennen" fix): start here with the name selected.
        ref={(el) => {
          if (el && takeRenameFocus && editor.renamingId === role.id && document.activeElement !== el) {
            el.focus();
            el.select();
          }
        }}
        onFocus={() => {
          if (takeRenameFocus && editor.renamingId === role.id) editor.setRenamingId(null);
        }}
        value={value}
        maxLength={ORCHESTRA_LIMITS.name}
        disabled={readOnly}
        onChange={(e) => {
          setValue(e.target.value);
          setError(validateRoleName(editor.draft!, role.id, e.target.value));
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
      />
      <FieldError>{shown}</FieldError>
    </Field>
  );
}

function FieldProblems({ problems }: { problems: OrchestraProblem[] }) {
  if (!problems.length) return null;
  return (
    <div className="space-y-1.5">
      {problems.map((p) => (
        <ProblemItem key={p.id} problem={p} showTarget={false} />
      ))}
    </div>
  );
}

/** The role's settings (inspector column, inspector sheet and the mobile role editor). */
export function RoleFields({ role, mobile = false }: { role: OrchestraRole; mobile?: boolean }) {
  const { editor, items, pickerFor, setPickerFor, readOnly, setEditorFor } = useOrchestraPage();
  const draft = editor.draft!;
  const a = roleAssignment(role, draft, editor.workers);
  const autoPick = roleAssignment({ ...role, workerId: "" }, draft, editor.workers);
  const problems = problemsFor(editor.problems, role.id);
  const modelProblems = problems.filter((p) => p.field === "model");
  const reviewProblems = problems.filter((p) => p.field === "review");
  const loop = role.reviewLoop;
  const reviewerOptions = draft.roles
    .filter((r) => r.id !== role.id && (r.enabled || r.id === loop.reviewerRoleId))
    .map((r) => ({ value: r.id, label: `${r.name.trim() || r.id}${r.enabled ? "" : " (aus)"}` }));
  const pickerKey = `inspector:${role.id}`;
  const name = role.name.trim() || role.id;
  const atLimit = draft.roles.length >= ORCHESTRA_LIMITS.roles;

  return (
    <div className="space-y-5">
      <SwitchRow
        label="Rolle aktiv"
        description={role.enabled ? "Der Dirigent kann sie einsetzen." : "Der Dirigent ignoriert sie; die Einstellungen bleiben."}
        checked={role.enabled}
        disabled={readOnly}
        onCheckedChange={() => editor.toggleEnabled(role.id)}
      />
      {/* On phones the editor sheet is where a rename happens; on desktop the card renames inline. */}
      <NameField key={`${role.id}:${role.name}`} role={role} takeRenameFocus={mobile} />
      <Field invalid={modelProblems.some((p) => p.capability)}>
        <FieldLabel>Modell</FieldLabel>
        <ModelPicker
          items={items}
          value={a.configuredId}
          onValueChange={(id) => editor.assign(role.id, id)}
          filter={capabilityFilter(role)}
          title={pickerTitle(name)}
          hint={capabilityHint(role)}
          allowAuto
          autoSublabel={autoPick.worker ? workerLabel(autoPick.worker) : undefined}
          hiddenLabel={hiddenTextModels}
          revealedSelectable
          open={pickerFor === pickerKey}
          onOpenChange={(o) => setPickerFor(o ? pickerKey : null)}
          disabled={readOnly}
          placeholder={a.unavailable ? `${a.configuredId} (nicht verfügbar)` : "Modell wählen"}
        />
        <FieldProblems problems={modelProblems} />
      </Field>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium text-foreground md:text-ui">Darf</legend>
        <SwitchRow
          label="Dateien ändern"
          description="Edit/Write im Projektordner. Nur Agenten wie Claude Code, Gemini CLI oder pi können das."
          checked={role.editsFiles}
          disabled={readOnly}
          onCheckedChange={(v) => editor.updateRole(role.id, { editsFiles: v })}
        />
      </fieldset>
      <Field>
        <FieldLabel>Beschreibung</FieldLabel>
        <Textarea
          autosize={{ min: 2, max: 6 }}
          maxLength={ORCHESTRA_LIMITS.description}
          value={role.description}
          disabled={readOnly}
          onChange={(e) => editor.updateRole(role.id, { description: e.target.value })}
        />
        <FieldHint>Wofür der Dirigent diese Rolle einsetzt</FieldHint>
      </Field>
      <Field>
        <FieldLabel>Anweisung</FieldLabel>
        <Textarea
          autosize={{ min: 3, max: mobile ? 10 : 12 }}
          maxLength={ORCHESTRA_LIMITS.instructions}
          value={role.instructions}
          disabled={readOnly}
          onChange={(e) => editor.updateRole(role.id, { instructions: e.target.value })}
        />
        <FieldHint>Wird jeder Teilaufgabe dieser Rolle vorangestellt.</FieldHint>
      </Field>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-foreground md:text-ui">Prüfschleife</legend>
        <SwitchRow
          label="Von einer anderen Rolle prüfen lassen"
          description={
            !loop.enabled && reviewerOptions.length === 0
              ? "Dafür braucht es eine zweite aktive Rolle."
              : "Bei „Änderungen nötig“ bessert die Rolle nach."
          }
          checked={loop.enabled}
          disabled={readOnly || (!loop.enabled && reviewerOptions.length === 0)}
          onCheckedChange={(v) => editor.apply((c) => setReviewLoop(c, role.id, { enabled: v }), v ? "Prüfschleife eingeschaltet." : "Prüfschleife ausgeschaltet.")}
        />
        {loop.enabled ? (
          <>
            <Field>
              <FieldLabel>Prüfende Rolle</FieldLabel>
              <SimpleSelect
                options={reviewerOptions}
                value={loop.reviewerRoleId}
                placeholder="Rolle wählen"
                disabled={readOnly}
                onValueChange={(v) => editor.apply((c) => setReviewLoop(c, role.id, { reviewerRoleId: v }))}
              />
            </Field>
            <Field>
              <FieldLabel>Max. Runden</FieldLabel>
              <SegmentedControl
                aria-label="Max. Runden"
                value={String(loop.maxRounds)}
                onValueChange={(v) => editor.apply((c) => setReviewLoop(c, role.id, { maxRounds: Number(v) }))}
                disabled={readOnly}
                className="w-fit"
              >
                {[1, 2, 3].map((n) => (
                  <SegmentedItem key={n} value={String(n)} className="min-w-10" aria-label={n === 1 ? "1 Runde" : `${n} Runden`}>
                    {n}
                  </SegmentedItem>
                ))}
              </SegmentedControl>
            </Field>
          </>
        ) : null}
        <FieldProblems problems={reviewProblems} />
      </fieldset>
      {mobile ? (
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Button variant="outline" size="md" disabled={readOnly || !canMoveRole(draft, role.id, -1)} onClick={() => editor.moveRole(role.id, -1)}>
            <ArrowUp />
            Nach oben
          </Button>
          <Button variant="outline" size="md" disabled={readOnly || !canMoveRole(draft, role.id, 1)} onClick={() => editor.moveRole(role.id, 1)}>
            <ArrowDown />
            Nach unten
          </Button>
          <Button
            variant="outline"
            size="md"
            disabledReason={atLimit ? `Maximal ${ORCHESTRA_LIMITS.roles} Rollen` : undefined}
            disabled={readOnly}
            onClick={() => editor.duplicateRole(role.id)}
          >
            <Copy />
            Duplizieren
          </Button>
        </div>
      ) : null}
      <Button
        variant="danger-ghost"
        size={mobile ? "md" : "sm"}
        disabled={readOnly}
        onClick={() => {
          if (mobile) setEditorFor(null);
          editor.removeRole(role.id);
        }}
        className="-ml-2"
      >
        <Trash2 />
        Rolle entfernen
      </Button>
    </div>
  );
}

/** The Dirigent's settings: Modell, Anweisung and how it plans. */
export function ConductorFields() {
  const { editor, items, pickerFor, setPickerFor, readOnly } = useOrchestraPage();
  const draft = editor.draft!;
  const a = conductorAssignment(draft, editor.workers);
  const autoPick = conductorAssignment({ conductor: { ...draft.conductor, workerId: "" } }, editor.workers);
  const modelProblems = problemsFor(editor.problems, CONDUCTOR_TARGET).filter((p) => p.field === "model");
  const pickerKey = `inspector:${CONDUCTOR_TARGET}`;
  return (
    <div className="space-y-5">
      <Field>
        <FieldLabel>Modell</FieldLabel>
        <ModelPicker
          items={items}
          value={a.configuredId}
          onValueChange={(id) => editor.assign(CONDUCTOR_TARGET, id)}
          title="Modell für den Dirigenten"
          allowAuto
          autoSublabel={autoPick.worker ? workerLabel(autoPick.worker) : undefined}
          open={pickerFor === pickerKey}
          onOpenChange={(o) => setPickerFor(o ? pickerKey : null)}
          disabled={readOnly}
          placeholder={a.unavailable ? `${a.configuredId} (nicht verfügbar)` : "Modell wählen"}
        />
        <FieldProblems problems={modelProblems} />
      </Field>
      <Field>
        <FieldLabel>Anweisung</FieldLabel>
        <Textarea
          autosize={{ min: 3, max: 12 }}
          maxLength={ORCHESTRA_LIMITS.instructions}
          value={draft.conductor.instructions}
          disabled={readOnly}
          onChange={(e) => editor.updateConductorInstructions(e.target.value)}
        />
        <FieldHint>Zusatz-Anweisung für Planung und Zusammenfassung</FieldHint>
      </Field>
      <section className="space-y-1 rounded-md border border-border bg-card p-3">
        <h3 className="text-ui font-medium text-foreground">Wie der Dirigent plant</h3>
        <p className="text-ui text-muted-foreground">
          Er zerlegt die Aufgabe in Teilaufgaben, wählt für jede eine passende Rolle anhand ihrer Beschreibung und fasst die
          Ergebnisse am Ende zusammen.
        </p>
      </section>
    </div>
  );
}

function SelectionTitle() {
  const { editor } = useOrchestraPage();
  const sel = editor.selection;
  if (!sel) return null;
  if (sel.kind === "conductor") return <>Dirigent</>;
  const role = findRole(editor.draft!, sel.id);
  return <>{role ? role.name.trim() || role.id : ""}</>;
}

function selectionMeta(editor: ReturnType<typeof useOrchestraPage>["editor"]): string {
  const sel = editor.selection;
  if (!sel) return "";
  if (sel.kind === "conductor") return "plant und fasst zusammen";
  const role = findRole(editor.draft!, sel.id);
  return role ? COLUMN_LABEL[columnOf(role, editor.draft!)] : "";
}

/** Desktop (≥1280) inspector column: Prüfung, or the selected role/Dirigent. */
export function InspectorPanel() {
  const { editor } = useOrchestraPage();
  const sel = editor.selection;
  const role = sel?.kind === "role" ? findRole(editor.draft!, sel.id) : undefined;
  return (
    <aside aria-label="Inspektor" className="flex w-[300px] shrink-0 flex-col border-l border-border bg-surface">
      {sel ? (
        <>
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
            {sel.kind === "conductor" ? (
              <AudioWaveform aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <RoleIcon of={role ?? null} className="size-4 shrink-0 text-muted-foreground" />
            )}
            <h2 className="min-w-0 truncate text-ui font-semibold text-foreground">
              <SelectionTitle />
            </h2>
            <span className="truncate text-xs text-subtle-foreground">{selectionMeta(editor)}</span>
            <IconButton aria-label="Auswahl aufheben" size="icon-sm" className="ml-auto" onClick={() => editor.select(null)}>
              <X />
            </IconButton>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <SelectionBodyFor sel={sel} mobile={false} />
          </div>
        </>
      ) : (
        <>
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
            <h2 id="orchestra-checks" className="text-ui font-semibold text-foreground">
              Prüfung
            </h2>
            <span className="text-xs text-subtle-foreground">
              {editor.counts.errors + editor.counts.warnings ? `${editor.counts.errors + editor.counts.warnings} offen` : ""}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4" id="orchestra-checks-list" tabIndex={-1}>
            <ProblemList headingId="orchestra-checks" />
            <p className="mt-4 text-xs text-subtle-foreground">Wähle eine Rolle oder den Dirigenten, um sie zu bearbeiten.</p>
          </div>
        </>
      )}
    </aside>
  );
}

/**
 * Below 1280 (and on phones for the Prüfung list): the inspector as a sheet —
 * right on tablets/desktop, a full-height bottom sheet on phones.
 */
export function InspectorSheet({ mobile = false }: { mobile?: boolean }) {
  const { editor, problemsOpen, setProblemsOpen, editorFor, setEditorFor } = useOrchestraPage();
  // Desktop: the selection drives the sheet. Mobile: editorFor (tapping a row).
  const wanted = mobile
    ? editorFor
      ? editorFor === CONDUCTOR_TARGET
        ? ({ kind: "conductor" } as const)
        : ({ kind: "role", id: editorFor } as const)
      : null
    : editor.selection;
  const role = wanted?.kind === "role" ? findRole(editor.draft!, wanted.id) : undefined;
  // A role removed meanwhile closes the sheet.
  const sel = wanted?.kind === "role" && !role ? null : wanted;
  const showProblems = !sel && problemsOpen;
  const open = !!sel || problemsOpen;
  const title = sel ? (sel.kind === "conductor" ? "Dirigent" : role ? role.name.trim() || role.id : "Rolle") : "Prüfung";
  const meta = sel
    ? sel.kind === "conductor"
      ? "plant, verteilt an Rollen, fasst zusammen"
      : role
        ? `${COLUMN_LABEL[columnOf(role, editor.draft!)]} · ${role.editsFiles ? "darf Dateien ändern" : "nur lesen"}`
        : ""
    : "Probleme und Hinweise der Besetzung";

  const close = () => {
    setProblemsOpen(false);
    if (mobile) setEditorFor(null);
    else editor.select(null);
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()}>
      <SheetContent
        side={mobile ? "bottom" : "right"}
        className={cn(mobile && sel ? "h-[92dvh]" : undefined)}
        onCloseAutoFocus={(e) => {
          // A rename started from the Prüfung list keeps focus in the name field.
          if (editor.renamingId) e.preventDefault();
        }}
      >
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{meta}</SheetDescription>
        </SheetHeader>
        <SheetBody className={cn(mobile ? "pb-6" : "")}>
          {showProblems ? <ProblemList /> : sel ? <SelectionBodyFor sel={sel} mobile={mobile} /> : null}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

function SelectionBodyFor({ sel, mobile }: { sel: { kind: "conductor" } | { kind: "role"; id: string }; mobile: boolean }) {
  const { editor } = useOrchestraPage();
  if (sel.kind === "conductor") return <ConductorFields />;
  const role = findRole(editor.draft!, sel.id);
  return role ? <RoleFields key={role.id} role={role} mobile={mobile} /> : null;
}
