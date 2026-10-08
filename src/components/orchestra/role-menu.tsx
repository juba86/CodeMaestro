"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Copy, Ellipsis, Pencil, Power, PowerOff, Trash2 } from "lucide-react";
import { ORCHESTRA_LIMITS, type OrchestraRole } from "@/lib/assistant/orchestra-types";
import { IconButton } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useOrchestraPage } from "./context";
import { canMoveRole } from "./edit";

/**
 * ⋯ menu of a role card: Umbenennen, Aktivieren/Deaktivieren, Nach oben/unten,
 * Duplizieren, Entfernen (§6.3.6). `focusAfter` gets focus when the trigger
 * is gone (after Entfernen); `onRename` starts inline renaming.
 */
export function RoleActionsMenu({
  role,
  onRename,
  focusAfterRemoveId,
  className,
}: {
  role: OrchestraRole;
  onRename?: () => void;
  focusAfterRemoveId?: string;
  className?: string;
}) {
  const { editor, readOnly } = useOrchestraPage();
  const draft = editor.draft!;
  const after = React.useRef<"rename" | "remove" | null>(null);
  const atLimit = draft.roles.length >= ORCHESTRA_LIMITS.roles;
  const name = role.name.trim() || role.id;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={readOnly}>
        <IconButton aria-label={`Aktionen für ${name}`} size="icon-sm" className={className}>
          <Ellipsis />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-52"
        onCloseAutoFocus={(e) => {
          const next = after.current;
          after.current = null;
          if (next === "rename") {
            // The inline name field takes focus itself.
            e.preventDefault();
          } else if (next === "remove") {
            e.preventDefault();
            if (focusAfterRemoveId) document.getElementById(focusAfterRemoveId)?.focus();
          }
        }}
      >
        {onRename ? (
          <DropdownMenuItem
            onSelect={() => {
              after.current = "rename";
              onRename();
            }}
          >
            <Pencil />
            Umbenennen
            <DropdownMenuShortcut>F2</DropdownMenuShortcut>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={() => editor.toggleEnabled(role.id)}>
          {role.enabled ? <PowerOff /> : <Power />}
          {role.enabled ? "Deaktivieren" : "Aktivieren"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!canMoveRole(draft, role.id, -1)} onSelect={() => editor.moveRole(role.id, -1)}>
          <ArrowUp />
          Nach oben
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!canMoveRole(draft, role.id, 1)} onSelect={() => editor.moveRole(role.id, 1)}>
          <ArrowDown />
          Nach unten
        </DropdownMenuItem>
        <DropdownMenuItem disabled={atLimit} onSelect={() => editor.duplicateRole(role.id)}>
          <Copy />
          {atLimit ? `Duplizieren (max. ${ORCHESTRA_LIMITS.roles} Rollen)` : "Duplizieren"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="danger"
          onSelect={() => {
            after.current = "remove";
            editor.removeRole(role.id);
          }}
        >
          <Trash2 />
          Entfernen
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
