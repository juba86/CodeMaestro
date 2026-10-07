"use client";

import * as React from "react";
import type { ModelPickerItem } from "@/components/ui/model-picker";
import type { OrchestraColumn } from "./derive";
import type { LiveView } from "./live";
import type { OrchestraProblem, OrchestraProblemFix } from "./problems";
import type { DragOver, DragPayload } from "./use-drag-assign";
import type { OrchestraEditor } from "./use-orchestra-editor";

/** Shared state of the /orchestra page (editor, live view, drag, open layers). */
export interface OrchestraPageContextValue {
  editor: OrchestraEditor;
  items: ModelPickerItem[];
  /** Live highlights while a run is followed; null otherwise. */
  live: LiveView | null;
  /** Editing is off (the configuration could not be loaded). */
  readOnly: boolean;
  layout: "mobile" | "desktop";
  /** The inspector is a column (≥1280); below it opens as a sheet. */
  wide: boolean;
  drag: {
    dragging: DragPayload | null;
    over: DragOver | null;
    startProps: (
      payload: DragPayload,
      opts?: { preventDefault?: boolean; disabled?: boolean }
    ) => { onPointerDown: (e: React.PointerEvent<HTMLElement>) => void };
    consumeClick: () => boolean;
  };
  /** Which ModelPicker is open: `slot:<target>` or `inspector:<target>`. */
  pickerFor: string | null;
  setPickerFor: (key: string | null) => void;
  /** Column whose „+ Rolle" popover is open (desktop) / the add sheet (mobile, "any"). */
  addOpen: OrchestraColumn | "any" | null;
  setAddOpen: (v: OrchestraColumn | "any" | null) => void;
  /** Mobile: the role editor sheet (role id or the Dirigent target). */
  editorFor: string | null;
  setEditorFor: (v: string | null) => void;
  /** The Prüfung list as a sheet (mobile, and desktop below 1280). */
  problemsOpen: boolean;
  setProblemsOpen: (v: boolean) => void;
  /** Runs a problem fix (config change or UI intent). */
  runFix: (problem: OrchestraProblem, fix: OrchestraProblemFix) => void;
  /** Selects a role/the Dirigent and brings its card into view. */
  reveal: (target: string, opts?: { focus?: boolean }) => void;
  /** „Änderungen gelten ab dem nächsten Lauf." plus the running run's start time. */
  runningSince: number | null;
}

const Ctx = React.createContext<OrchestraPageContextValue | null>(null);

export function OrchestraPageProvider({ value, children }: { value: OrchestraPageContextValue; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOrchestraPage(): OrchestraPageContextValue {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("useOrchestraPage outside OrchestraPageProvider");
  return v;
}
