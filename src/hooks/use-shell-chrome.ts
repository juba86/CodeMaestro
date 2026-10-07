"use client";

import { useLayoutEffect, useState } from "react";
import { useUIStore } from "@/stores/ui-store";

export interface ShellChromeOptions {
  /** Show the shell's mobile AppBar (default true). */
  appBar?: boolean;
  /** Show the shell's mobile TabBar (default true). */
  tabBar?: boolean;
}

// Every mounted caller and what it asks for. A bar is hidden while any caller
// hides it, so a nested screen (or the next screen mounting before the previous
// one's cleanup) cannot show a bar another mounted screen still hides.
const holders = new Map<object, Required<ShellChromeOptions>>();

function apply() {
  let appBarHidden = false;
  let tabBarHidden = false;
  for (const h of holders.values()) {
    if (!h.appBar) appBarHidden = true;
    if (!h.tabBar) tabBarHidden = true;
  }
  useUIStore.getState().setChrome({ appBarHidden, tabBarHidden });
}

/**
 * Hides the shell's mobile AppBar and/or TabBar while the calling screen is
 * mounted (screens that render their own bar: assistant thread, orchestra,
 * detail screens). Restores the bars on unmount and follows option changes.
 * Runs as a layout effect so the bars never flash before the first paint.
 */
export function useShellChrome({ appBar = true, tabBar = true }: ShellChromeOptions = {}): void {
  const [holder] = useState(() => ({}));
  useLayoutEffect(() => {
    holders.set(holder, { appBar, tabBar });
    apply();
    return () => {
      holders.delete(holder);
      apply();
    };
  }, [holder, appBar, tabBar]);
}
