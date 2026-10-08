"use client";

import * as React from "react";
import { FileText, MoreHorizontal, PanelLeftOpen, PanelRight, Server, ShieldX, Square, Trash2 } from "lucide-react";
import { AppBar } from "@/components/ui/app-bar";
import { Button, IconButton } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBadge } from "@/components/ui/status-badge";
import { providerLabel } from "@/lib/labels";
import { isActive, type RunState } from "@/lib/run-state";
import type { InspectorTab } from "./inspector";
import { shortPath } from "./session-list";
import type { SessionInfo } from "./types";

export interface ThreadHeaderProps {
  title: string;
  info: SessionInfo | null;
  state: RunState;
  stateDetail?: string;
  stopping: boolean;
  /** A run this page followed may still go (also while its state is unknown). */
  running?: boolean;
  /** Open approvals that „Alle ablehnen" would deny. */
  pendingCount: number;
  onStop: () => void;
  onDenyAll: () => void;
  onDelete: () => void;
  /** Opens the inspector (sheet) at a tab; undefined when the inspector is a column. */
  onInspector?: (tab: InspectorTab) => void;
  listCollapsed?: boolean;
  onExpandList?: () => void;
}

function MoreMenu({
  pendingCount,
  onDenyAll,
  onDelete,
  onInspector,
  mobile,
}: Pick<ThreadHeaderProps, "pendingCount" | "onDenyAll" | "onDelete" | "onInspector"> & { mobile?: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton aria-label="Weitere Aktionen">
          <MoreHorizontal />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {onInspector ? (
          <>
            <DropdownMenuItem onSelect={() => onInspector("run")}>
              <PanelRight />
              Details
            </DropdownMenuItem>
            {mobile ? (
              <>
                <DropdownMenuItem onSelect={() => onInspector("files")}>
                  <FileText />
                  Dateien
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onInspector("dev")}>
                  <Server />
                  Dev-Server
                </DropdownMenuItem>
              </>
            ) : null}
            <DropdownMenuSeparator />
          </>
        ) : null}
        {pendingCount > 0 ? (
          <DropdownMenuItem onSelect={onDenyAll}>
            <ShieldX />
            Alle ablehnen
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem variant="danger" onSelect={onDelete}>
          <Trash2 />
          Session löschen
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function metaLine(info: SessionInfo | null): string {
  if (!info) return "";
  return [providerLabel(info.provider), info.model].filter(Boolean).join(" · ");
}

/** Desktop pane header (48px): title + state, cwd · agent · model, stop and menu. */
export function ThreadHeader(props: ThreadHeaderProps) {
  const { title, info, state, stateDetail, stopping, running, onStop, onInspector, listCollapsed, onExpandList } = props;
  const active = (isActive(state) || !!running) && state !== "stopping";
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4 md:px-6">
      {listCollapsed && onExpandList ? (
        <IconButton aria-label="Sessionliste ausklappen" tooltip="Sessionliste ein/aus (⌘\ oder Strg+ß)" onClick={onExpandList} className="-ml-2">
          <PanelLeftOpen />
        </IconButton>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="min-w-0 truncate text-ui font-semibold">{title}</h1>
          {info ? <StatusBadge state={state} detail={stateDetail} className="shrink-0" /> : null}
        </div>
        {info ? (
          <p className="truncate text-xs text-muted-foreground">
            <span className="font-mono">{shortPath(info.cwd)}</span>
            {metaLine(info) ? ` · ${metaLine(info)}` : ""}
          </p>
        ) : null}
      </div>
      {active || stopping ? (
        <Button variant="danger-outline" size="sm" onClick={onStop} loading={stopping} tooltip="Lauf stoppen (⌘.)">
          {stopping ? null : <Square aria-hidden className="fill-current" />}
          {stopping ? "Wird gestoppt …" : "Stoppen"}
        </Button>
      ) : null}
      {onInspector ? (
        <IconButton aria-label="Details anzeigen" tooltip="Details" onClick={() => onInspector("run")}>
          <PanelRight />
        </IconButton>
      ) : null}
      <MoreMenu {...props} onInspector={undefined} />
    </header>
  );
}

/** Mobile thread AppBar (DESIGN.md §6.2.2). */
export function ThreadAppBar(props: ThreadHeaderProps) {
  const { title, info, state, stateDetail, stopping, running, onStop } = props;
  const active = (isActive(state) || !!running) && state !== "stopping";
  return (
    <AppBar
      back={{ href: "/assistant", label: "Sessions" }}
      title={title}
      titleAs="h1"
      subtitle={
        info ? (
          <>
            <StatusBadge state={state} detail={stateDetail} className="shrink-0" />
            <span className="truncate">{metaLine(info)}</span>
          </>
        ) : undefined
      }
      actions={
        <>
          {active || stopping ? (
            <IconButton aria-label="Lauf stoppen" variant="danger-outline" loading={stopping} onClick={onStop}>
              <Square className="fill-current" />
            </IconButton>
          ) : null}
          <MoreMenu {...props} mobile />
        </>
      }
    />
  );
}
