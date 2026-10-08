"use client";

import { create } from "zustand";

/** Shell overlays that several components open (palette, activity, help, Mehr). Not persisted. */
interface ShellOverlays {
  palette: boolean;
  /** Mobile Activity sheet (the desktop popover keeps its own state). */
  activity: boolean;
  shortcuts: boolean;
  more: boolean;
  setPalette: (open: boolean) => void;
  setActivity: (open: boolean) => void;
  setShortcuts: (open: boolean) => void;
  setMore: (open: boolean) => void;
}

export const useShellOverlays = create<ShellOverlays>()((set) => ({
  palette: false,
  activity: false,
  shortcuts: false,
  more: false,
  setPalette: (palette) => set({ palette }),
  setActivity: (activity) => set({ activity }),
  setShortcuts: (shortcuts) => set({ shortcuts }),
  setMore: (more) => set({ more }),
}));

/** Opens the command palette (⌘K) from anywhere, e.g. a page's search button. */
export function openCommandPalette(): void {
  useShellOverlays.setState({ palette: true });
}

/** Opens the keyboard shortcut help sheet (`?`). */
export function openShortcutsHelp(): void {
  useShellOverlays.setState({ shortcuts: true });
}

/** Opens the mobile Activity sheet. */
export function openActivitySheet(): void {
  useShellOverlays.setState({ activity: true });
}
