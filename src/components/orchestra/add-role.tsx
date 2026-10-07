"use client";

import * as React from "react";
import { Plus, UserRoundPlus } from "lucide-react";
import { ORCHESTRA_LIMITS } from "@/lib/assistant/orchestra-types";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { useOrchestraPage } from "./context";
import { COLUMN_LABEL, EXTRA_ROLE_TEMPLATES, type OrchestraColumn, type RoleTemplate } from "./derive";
import { RoleIcon } from "./role-chip";
import { CUSTOM_ROLE_TEMPLATE, roleSuggestions } from "./edit";

const REVIEW_TEMPLATES = new Set(["reviewer", "sicherheit"]);

/** Where a suggestion lands (its own capability decides; reviewers go to Prüfen). */
export function templateColumn(t: RoleTemplate): OrchestraColumn {
  if (REVIEW_TEMPLATES.has(t.id)) return "review";
  return t.editsFiles ? "build" : "plan";
}

export const LIMIT_REASON = `Maximal ${ORCHESTRA_LIMITS.roles} Rollen`;

/** Suggestions (fitting the column first) plus „Eigene Rolle …". */
export function AddRoleList({
  column,
  onPick,
  size = "md",
}: {
  column: OrchestraColumn | null;
  onPick: (template: RoleTemplate) => void;
  size?: "md" | "lg";
}) {
  const { editor } = useOrchestraPage();
  const suggestions = roleSuggestions(editor.draft!, EXTRA_ROLE_TEMPLATES);
  const fits = column ? suggestions.filter((t) => templateColumn(t) === column) : suggestions;
  const rest = column ? suggestions.filter((t) => templateColumn(t) !== column) : [];
  const item = (t: RoleTemplate, landsIn?: OrchestraColumn) => {
    return (
      <li key={t.id}>
        <button
          type="button"
          onClick={() => onPick(t)}
          className={cn(
            "flex w-full items-start gap-2.5 rounded-md px-2 text-left hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
            size === "lg" ? "min-h-14 py-2.5" : "min-h-10 py-2",
          )}
        >
          <span aria-hidden className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-surface-2 text-subtle-foreground [&_svg]:size-3.5">
            <RoleIcon of={{ id: t.id, name: t.name }} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className={cn("font-medium text-foreground", size === "lg" ? "text-base" : "text-ui")}>
              {t.name}
              {landsIn ? <span className="ml-1.5 font-normal text-subtle-foreground">→ {COLUMN_LABEL[landsIn]}</span> : null}
            </span>
            <span className={cn("line-clamp-2 text-muted-foreground", size === "lg" ? "text-sm" : "text-xs")}>{t.description}</span>
          </span>
        </button>
      </li>
    );
  };
  return (
    <div className="flex flex-col gap-1">
      {fits.length ? (
        <ul aria-label={column ? `Vorschläge für ${COLUMN_LABEL[column]}` : "Vorschläge"} className="flex flex-col">
          {fits.map((t) => item(t))}
        </ul>
      ) : null}
      {rest.length ? (
        <>
          <p className="px-2 pt-2 text-xs font-medium text-subtle-foreground">Weitere Rollen</p>
          <ul aria-label="Weitere Rollen" className="flex flex-col">
            {rest.map((t) => item(t, templateColumn(t)))}
          </ul>
        </>
      ) : null}
      <div className={cn(suggestions.length ? "mt-1 border-t border-border pt-1" : "")}>
        <button
          type="button"
          onClick={() => onPick(CUSTOM_ROLE_TEMPLATE)}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-md px-2 text-left font-medium text-foreground hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
            size === "lg" ? "min-h-12 text-base" : "min-h-9 text-ui",
          )}
        >
          <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-md border border-dashed border-border-strong text-subtle-foreground [&_svg]:size-3.5">
            <UserRoundPlus />
          </span>
          Eigene Rolle …
        </button>
      </div>
    </div>
  );
}

/** Dashed „+ Rolle" at the end of a desktop column. */
export function AddRoleButton({ column }: { column: OrchestraColumn }) {
  const { editor, readOnly, addOpen, setAddOpen, wide } = useOrchestraPage();
  const atLimit = editor.draft!.roles.length >= ORCHESTRA_LIMITS.roles;
  const open = addOpen === column;
  const picked = React.useRef(false);
  const className =
    "flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border-strong text-xs font-medium text-muted-foreground hover:border-ring hover:text-foreground";
  if (atLimit || readOnly) {
    return (
      <Button
        id={`add-role-${column}`}
        variant="ghost"
        className={cn(className, "hover:bg-transparent")}
        disabledReason={readOnly ? "Konfiguration nicht geladen" : LIMIT_REASON}
      >
        <Plus />
        Rolle
      </Button>
    );
  }
  return (
    <Popover open={open} onOpenChange={(o) => setAddOpen(o ? column : null)}>
      <SimpleTooltip content={`Rolle zu „${COLUMN_LABEL[column]}“ hinzufügen`}>
        <PopoverTrigger asChild>
          <button id={`add-role-${column}`} type="button" className={cn(className, "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring")}>
            <Plus aria-hidden className="size-3.5" />
            Rolle
            <span className="sr-only"> zu {COLUMN_LABEL[column]} hinzufügen</span>
          </button>
        </PopoverTrigger>
      </SimpleTooltip>
      <PopoverContent
        align="center"
        className="w-80 p-1.5"
        aria-label={`Rolle zu ${COLUMN_LABEL[column]} hinzufügen`}
        onCloseAutoFocus={(e) => {
          // The new card opens in rename mode and takes focus itself.
          if (picked.current) e.preventDefault();
          picked.current = false;
        }}
      >
        <p className="px-2 pb-1 pt-1.5 text-xs font-medium text-subtle-foreground">Rolle hinzufügen · {COLUMN_LABEL[column]}</p>
        <AddRoleList
          column={column}
          onPick={(t) => {
            const id = editor.addRole(t, column);
            if (id) {
              picked.current = true;
              if (wide) editor.select({ kind: "role", id });
              editor.setRenamingId(id);
            }
            setAddOpen(null);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
