"use client";

import * as React from "react";
import {
  AudioWaveform,
  CodeXml,
  DraftingCompass,
  FilePen,
  FileText,
  LoaderCircle,
  PenOff,
  Repeat2,
  ScanEye,
  type LucideIcon,
} from "lucide-react";
import { ORCHESTRA_LIMITS, reviewerFor, type OrchestraRole } from "@/lib/assistant/orchestra-types";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { Skeleton } from "@/components/ui/skeleton";
import { formatClock } from "@/lib/format";
import { AddRoleButton } from "./add-role";
import { useOrchestraPage } from "./context";
import { COLUMN_LABEL, ORCHESTRA_COLUMNS, columnOf, rolesByColumn, type OrchestraColumn } from "./derive";
import { CONDUCTOR_TARGET, validateRoleName } from "./edit";
import { dropKeyOf, ModelSlot } from "./model-slot";
import { LiveBadge } from "./orchestra-live-list";
import { problemsFor } from "./problems";
import { RoleIcon } from "./role-chip";
import { RoleActionsMenu } from "./role-menu";

export const COLUMN_ICON: Record<OrchestraColumn, LucideIcon> = {
  plan: DraftingCompass,
  build: CodeXml,
  review: ScanEye,
};

const COLUMN_EMPTY: Record<OrchestraColumn, string> = {
  plan: "Keine Rolle, die nur liest.",
  build: "Keine Rolle, die Dateien ändert.",
  review: "Noch keine Prüfschleife – schalte sie bei einer Rolle ein.",
};

export const roleCardId = (roleId: string) => `role-card-${roleId}`;
export const roleMainId = (roleId: string) => `role-main-${roleId}`;
export const CONDUCTOR_MAIN_ID = "conductor-main";

// The stretched main button makes the whole card selectable while slot and
// menu stay separate buttons on top (no nested interactive elements).
const STRETCHED =
  "min-w-0 truncate text-left after:absolute after:inset-0 after:rounded-[inherit] after:content-[''] focus-visible:outline-none";
const CARD_FOCUS =
  "has-[[data-card-main]:focus-visible]:outline-2 has-[[data-card-main]:focus-visible]:outline-offset-2 has-[[data-card-main]:focus-visible]:outline-ring";

function quoteShort(text: string, max = 48): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()} …` : one;
}

/** Inline rename: Enter saves, Esc cancels; empty or duplicate names are rejected inline. */
function RoleNameInput({ role }: { role: OrchestraRole }) {
  const { editor } = useOrchestraPage();
  const [value, setValue] = React.useState(role.name);
  const [error, setError] = React.useState<string | null>(null);
  const errId = React.useId();
  const done = React.useRef(false);
  const finish = (save: boolean) => {
    if (done.current) return;
    if (save) {
      const problem = validateRoleName(editor.draft!, role.id, value);
      if (problem) {
        setError(problem);
        return;
      }
      editor.rename(role.id, value);
    }
    done.current = true;
    editor.setRenamingId(null);
    requestAnimationFrame(() => document.getElementById(roleMainId(role.id))?.focus());
  };
  return (
    <div className="relative z-10 min-w-0 flex-1">
      <input
        // Rename mode is entered on purpose (F2, menu, new role): focus the field.
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        aria-label="Name der Rolle"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errId : undefined}
        maxLength={ORCHESTRA_LIMITS.name}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError(validateRoleName(editor.draft!, role.id, e.target.value));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            finish(true);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            finish(false);
          }
        }}
        onBlur={() => {
          // Leaving the field keeps a valid name and drops an invalid one.
          if (validateRoleName(editor.draft!, role.id, value)) finish(false);
          else finish(true);
        }}
        className="h-7 w-full rounded-md border border-input bg-background px-2 text-ui font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring aria-[invalid=true]:border-danger"
      />
      {error ? (
        <p id={errId} role="alert" className="absolute left-0 top-full z-20 mt-1 whitespace-nowrap rounded-md border border-danger-border bg-popover px-2 py-1 text-xs text-danger shadow-md">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Dashed review arrows in the gap between a reviewed card (Umsetzen) and its reviewer (Prüfen). */
function ReviewArrows({ active }: { active: boolean }) {
  const dash = active ? "motion-safe:animate-dash" : undefined;
  return (
    <div aria-hidden className="pointer-events-none absolute left-full top-1/2 z-10 flex w-10 -translate-y-1/2 justify-center">
      <svg width="34" height="22" viewBox="0 0 34 22" className={active ? "text-primary-text" : "text-primary-border"}>
        <line x1="2" y1="6" x2="29" y2="6" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" className={dash} />
        <path d="M27 3 L31 6 L27 9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="32" y1="16" x2="5" y2="16" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" className={dash} />
        <path d="M7 13 L3 16 L7 19" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function RoleFooter({ role, column }: { role: OrchestraRole; column: OrchestraColumn }) {
  const { editor, live } = useOrchestraPage();
  const draft = editor.draft!;
  const lv = live?.roles[role.id];
  if (lv && lv.detail && (lv.active || lv.status === "in_review" || lv.status === "error" || lv.status === "waiting")) {
    return (
      <p
        className={cn(
          "flex min-w-0 items-center gap-1.5 text-xs",
          lv.status === "error" ? "text-danger" : lv.active ? "text-primary-text" : "text-muted-foreground",
        )}
      >
        {lv.active ? <LoaderCircle aria-hidden className="size-3.5 shrink-0 motion-safe:animate-spin" /> : null}
        <span className="truncate">{lv.status === "waiting" || lv.status === "error" ? lv.detail : `„${lv.detail}“`}</span>
        {[lv.meta, lv.progress].filter(Boolean).length ? (
          <span className="shrink-0 tabular-nums text-muted-foreground">{[lv.meta, lv.progress].filter(Boolean).join(" · ")}</span>
        ) : null}
      </p>
    );
  }
  if (column === "review") {
    const reviewed = draft.roles.filter(
      (r) => r.id !== role.id && r.enabled && r.reviewLoop.enabled && r.reviewLoop.reviewerRoleId === role.id,
    );
    return (
      <p className="flex min-w-0 items-center gap-1.5 text-xs text-primary-text">
        <Repeat2 aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate">prüft {reviewed.map((r) => r.name.trim() || r.id).join(", ")}</span>
      </p>
    );
  }
  const reviewer = reviewerFor(draft, role);
  if (reviewer && role.enabled) {
    const rounds = role.reviewLoop.maxRounds;
    return (
      <p className="flex min-w-0 items-center gap-1.5 text-xs text-primary-text">
        <Repeat2 aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate">
          {reviewer.name.trim() || reviewer.id} prüft · max. {rounds} {rounds === 1 ? "Runde" : "Runden"}
        </span>
      </p>
    );
  }
  const Cap = role.editsFiles ? FilePen : FileText;
  return (
    <p className="flex min-w-0 items-center gap-1.5 text-xs text-subtle-foreground">
      <Cap aria-hidden className="size-3.5 shrink-0" />
      <span className="truncate">
        {role.editsFiles ? "darf Dateien ändern" : "nur lesen"}
        {role.description.trim() ? ` · „${quoteShort(role.description)}“` : ""}
      </span>
    </p>
  );
}

function RoleCard({ role, column }: { role: OrchestraRole; column: OrchestraColumn }) {
  const ctx = useOrchestraPage();
  const { editor, live, drag, readOnly } = ctx;
  const draft = editor.draft!;
  const selected = editor.selection?.kind === "role" && editor.selection.id === role.id;
  const renaming = editor.renamingId === role.id;
  const lv = live?.roles[role.id];
  const isLive = !!lv?.active;
  const problems = problemsFor(editor.problems, role.id).filter((p) => p.severity !== "info");
  const capability = problems.find((p) => p.capability);
  const warnings = problems.filter((p) => !p.capability);
  const key = dropKeyOf(role.id);
  const errId = `${roleCardId(role.id)}-cap`;
  const name = role.name.trim() || "Ohne Namen";

  // A link only between neighbouring columns (Umsetzen → Prüfen); others use the text line.
  const reviewer = role.enabled ? reviewerFor(draft, role) : null;
  const showArrows = column === "build" && !!reviewer && columnOf(reviewer, draft) === "review";
  const arrowsActive = !!live?.reviewLinks.includes(role.id);

  const select = () => {
    if (drag.consumeClick()) return;
    editor.select({ kind: "role", id: role.id });
  };

  return (
    <div className="relative" id={roleCardId(role.id)}>
      <Card
        asChild
        variant={isLive ? "live" : "default"}
        sweep={isLive}
        className={cn(
          "relative space-y-2.5 p-3",
          CARD_FOCUS,
          // Deactivated: dashed outline, dimmed icon and muted name (no opacity on text: contrast stays AA).
          !role.enabled && !isLive && "border-dashed border-border-strong bg-card/60 shadow-none",
          capability && !isLive && "border-danger-border",
          selected && "ring-2 ring-ring ring-offset-2 ring-offset-background",
        )}
      >
        <article
          // While renaming, the name button (the usual label) is replaced by the input.
          aria-labelledby={renaming ? undefined : roleMainId(role.id)}
          aria-label={renaming ? name : undefined}
          data-drop-target={readOnly ? undefined : key}
          data-selected={selected || undefined}
        >
          <header className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-md [&_svg]:size-4",
                isLive ? "bg-primary-subtle text-primary-text" : "bg-surface-2 text-muted-foreground",
                !role.enabled && !isLive && "opacity-60",
              )}
            >
              <RoleIcon of={role} />
            </span>
            {renaming ? (
              <RoleNameInput role={role} />
            ) : (
              <button
                id={roleMainId(role.id)}
                type="button"
                data-card-main
                aria-current={selected ? "true" : undefined}
                onClick={select}
                onDoubleClick={() => !readOnly && editor.setRenamingId(role.id)}
                onKeyDown={(e) => {
                  if (e.key === "F2" && !readOnly) {
                    e.preventDefault();
                    editor.setRenamingId(role.id);
                  }
                }}
                className={cn(
                  STRETCHED,
                  "text-ui font-semibold",
                  role.enabled ? "text-foreground" : "text-muted-foreground",
                  !role.name.trim() && "italic text-danger",
                )}
              >
                {name}
              </button>
            )}
            {warnings.length && !renaming ? (
              <span className="relative z-10 shrink-0" title={warnings.map((w) => w.message).join("\n")}>
                <span aria-hidden className="block size-2 rounded-full bg-warning" />
                <span className="sr-only">{warnings.length === 1 ? "1 Hinweis" : `${warnings.length} Hinweise`}: {warnings.map((w) => w.message).join(" ")}</span>
              </span>
            ) : null}
            <span className="ml-auto flex shrink-0 items-center gap-1">
              {lv ? (
                <LiveBadge label={lv.short ?? lv.label} tone={lv.tone} active={lv.active} srLabel={lv.label} />
              ) : !role.enabled ? (
                <Badge variant="neutral">aus</Badge>
              ) : null}
              <RoleActionsMenu
                role={role}
                className="relative z-10 -mr-1"
                onRename={() => editor.setRenamingId(role.id)}
                focusAfterRemoveId={`add-role-${column}`}
              />
            </span>
          </header>
          <ModelSlot target={role.id} role={role} errorId={capability ? errId : undefined} />
          {capability ? (
            <p id={errId} className="flex items-start gap-1.5 text-xs text-danger">
              <PenOff aria-hidden className="mt-px size-3.5 shrink-0" />
              <span>
                {capability.id.startsWith("no-file-worker")
                  ? "Kein Modell mit Dateizugriff verfügbar."
                  : "Darf Dateien ändern – dieses Modell kann das nicht."}
              </span>
            </p>
          ) : null}
          <RoleFooter role={role} column={column} />
        </article>
      </Card>
      {showArrows ? <ReviewArrows active={arrowsActive} /> : null}
    </div>
  );
}

function ConductorCard() {
  const { editor, live, drag, readOnly } = useOrchestraPage();
  const draft = editor.draft!;
  const selected = editor.selection?.kind === "conductor";
  const cv = live?.conductor;
  const isLive = !!cv?.active;
  const instructions = draft.conductor.instructions.trim();
  return (
    <Card
      asChild
      variant={isLive ? "live" : "default"}
      sweep={isLive}
      className={cn(
        "relative mx-auto block w-full max-w-[420px] rounded-xl border-primary-border p-3.5 shadow-sm",
        CARD_FOCUS,
        selected && "ring-2 ring-ring ring-offset-2 ring-offset-background",
      )}
    >
      <article aria-labelledby={CONDUCTOR_MAIN_ID} data-drop-target={readOnly ? undefined : "conductor"}>
        <div className="flex items-start gap-2.5">
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary-subtle text-primary-text [&_svg]:size-4">
            <AudioWaveform />
          </span>
          <div className="min-w-0 flex-1">
            <button
              id={CONDUCTOR_MAIN_ID}
              type="button"
              data-card-main
              aria-current={selected ? "true" : undefined}
              onClick={() => {
                if (drag.consumeClick()) return;
                editor.select({ kind: "conductor" });
              }}
              className={cn(STRETCHED, "block text-ui font-semibold text-foreground")}
            >
              Dirigent
            </button>
            <p className="text-xs text-muted-foreground">plant, verteilt an Rollen, fasst zusammen</p>
          </div>
          {cv && cv.phase !== "idle" ? <LiveBadge label={cv.label} tone={cv.tone} active={cv.active} /> : null}
        </div>
        <div className="mt-3">
          <ModelSlot target={CONDUCTOR_TARGET} role={null} />
        </div>
        <p className="mt-2.5 truncate text-xs text-muted-foreground">
          {instructions ? <>Anweisung: {quoteShort(instructions, 70)}</> : "Keine Zusatz-Anweisung"}
        </p>
      </article>
    </Card>
  );
}

function ColumnView({ column, roles }: { column: OrchestraColumn; roles: OrchestraRole[] }) {
  const { live } = useOrchestraPage();
  const working = !!live?.workingColumns.includes(column);
  const Icon = COLUMN_ICON[column];
  const headingId = `orchestra-col-${column}`;
  return (
    <section aria-labelledby={headingId} className="relative flex min-w-0 flex-col gap-3">
      <span
        aria-hidden
        className={cn("absolute left-1/2 top-0 h-4 -translate-x-1/2", working ? "w-0.5 bg-primary" : "w-px bg-border-strong")}
      />
      <h2
        id={headingId}
        className={cn(
          "relative mx-auto mt-4 flex w-fit items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold",
          working ? "border-primary-border bg-primary-subtle text-primary-text" : "border-border-strong bg-surface text-foreground",
        )}
      >
        <Icon aria-hidden className="size-3.5" />
        {COLUMN_LABEL[column]}
        <span className="font-normal text-subtle-foreground">
          <span className="sr-only">, </span>
          {roles.length}
          <span className="sr-only"> {roles.length === 1 ? "Rolle" : "Rollen"}</span>
        </span>
      </h2>
      {roles.map((role) => (
        <RoleCard key={role.id} role={role} column={column} />
      ))}
      {roles.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-subtle-foreground">{COLUMN_EMPTY[column]}</p>
      ) : null}
      <AddRoleButton column={column} />
    </section>
  );
}

// Column centres of a grid-cols-3 gap-x-10 row: (W − 80px)/6 from each edge.
const BUS_INSET = "calc((100% - 80px) / 6)";

function Wires() {
  const { live } = useOrchestraPage();
  const conductorLive = !!live?.conductor.active || !!live?.workingColumns.length;
  const cols = live?.workingColumns ?? [];
  return (
    <div aria-hidden className="relative h-10">
      <span className={cn("absolute left-1/2 top-0 h-full -translate-x-1/2", conductorLive ? "w-0.5 bg-primary" : "w-px bg-border-strong")} />
      <span className="absolute bottom-0 h-px bg-border-strong" style={{ left: BUS_INSET, right: BUS_INSET }} />
      {cols.includes("plan") ? <span className="absolute bottom-0 h-0.5 bg-primary" style={{ left: BUS_INSET, right: "50%" }} /> : null}
      {cols.includes("review") ? <span className="absolute bottom-0 h-0.5 bg-primary" style={{ left: "50%", right: BUS_INSET }} /> : null}
    </div>
  );
}

/** The org chart: Dirigent, CSS wires, three columns (§6.3.3). */
export function OrgCanvas() {
  const { editor, runningSince } = useOrchestraPage();
  const cols = rolesByColumn(editor.draft!);
  return (
    <div className="mx-auto min-w-[640px] max-w-[980px] px-6 pb-10 pt-6 2xl:px-8">
      <ConductorCard />
      <Wires />
      <div className="grid grid-cols-3 gap-x-10">
        {ORCHESTRA_COLUMNS.map((c) => (
          <ColumnView key={c} column={c} roles={cols[c]} />
        ))}
      </div>
      <p className="mt-6 text-center text-xs text-subtle-foreground">
        Änderungen gelten ab dem nächsten Lauf.
        {runningSince ? ` Der laufende Lauf nutzt die Besetzung von ${formatClock(runningSince)}.` : ""}
      </p>
    </div>
  );
}

export function CanvasSkeleton() {
  return (
    <div className="mx-auto min-w-[640px] max-w-[980px] px-6 pb-10 pt-6 2xl:px-8" aria-hidden>
      <div className="mx-auto max-w-[420px] rounded-xl border border-border bg-card p-3.5">
        <div className="flex items-center gap-2.5">
          <Skeleton className="size-8 rounded-lg" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-3 w-52" />
          </div>
        </div>
        <Skeleton className="mt-3 h-9 w-full" />
      </div>
      <div className="h-10" />
      <div className="grid grid-cols-3 gap-x-10">
        {[0, 1, 2].map((c) => (
          <div key={c} className="space-y-3">
            <Skeleton className="mx-auto mt-4 h-6 w-24 rounded-full" />
            {[0, 1].map((r) => (
              <div key={r} className="space-y-2.5 rounded-lg border border-border bg-card p-3">
                <div className="flex items-center gap-2">
                  <Skeleton className="size-7" />
                  <Skeleton className="h-3.5 w-20" />
                </div>
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-3 w-3/4" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
