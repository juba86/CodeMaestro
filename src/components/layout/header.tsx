"use client";

import { useSettingsStore } from "@/stores/settings-store";
import { Moon, Sun } from "lucide-react";
import { useEffect } from "react";
import { PushToggle } from "@/components/push-toggle";

// Installed desktop app in Window Controls Overlay mode (manifest
// display_override): the header doubles as the draggable title bar and keeps
// its buttons clear of the OS window controls.
const TITLEBAR_CSS = `@media (display-mode: window-controls-overlay) {
  .cm-titlebar { -webkit-app-region: drag; app-region: drag;
    padding-right: max(1rem, calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw) + 0.5rem)); }
  .cm-titlebar button, .cm-titlebar a { -webkit-app-region: no-drag; app-region: no-drag; }
}`;

export function Header() {
  const { theme, setTheme } = useSettingsStore();

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
      return;
    }
    if (theme === "light") {
      root.classList.remove("dark");
      return;
    }
    // System: follow the OS preference and keep tracking live changes.
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => root.classList.toggle("dark", mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);

  return (
    <header className="cm-titlebar flex items-center justify-between px-4 h-12 border-b border-border bg-background">
      <style>{TITLEBAR_CSS}</style>
      <div className="text-sm text-muted-foreground">
        CodeMaestro · AI coding control plane
      </div>
      <div className="flex items-center gap-2">
        <PushToggle />
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          className="p-2 rounded-md hover:bg-accent text-muted-foreground"
        >
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
    </header>
  );
}
