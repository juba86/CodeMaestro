"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useSettingsStore } from "@/stores/settings-store";

export const THEME_COLOR = { dark: "#0d0d0f", light: "#fbfcfd" } as const;
export const THEME_STORAGE_KEY = "cm-theme";

function setThemeColor(color: string) {
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  if (metas.length === 0) {
    const m = document.createElement("meta");
    m.name = "theme-color";
    m.content = color;
    document.head.appendChild(m);
    return;
  }
  metas.forEach((m) => m.setAttribute("content", color));
}

/**
 * Applies the stored theme (useSettingsStore().theme stays the source of
 * truth): toggles `.dark` on <html>, follows the OS while the theme is
 * "system", mirrors the choice to localStorage "cm-theme" for the pre-paint
 * script and keeps <meta name="theme-color"> in sync. Renders nothing.
 */
export function ThemeController() {
  const theme = useSettingsStore((s) => s.theme);

  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && mq.matches);
      root.classList.toggle("dark", dark);
      setThemeColor(dark ? THEME_COLOR.dark : THEME_COLOR.light);
    };
    apply();
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // storage blocked: the pre-paint script falls back to the zustand store / dark
    }
    if (theme !== "system") return;
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);

  return null;
}

function subscribeHtmlClass(onChange: () => void) {
  const obs = new MutationObserver(onChange);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => obs.disconnect();
}

const readResolved = (): "dark" | "light" =>
  document.documentElement.classList.contains("dark") ? "dark" : "light";

/** The theme actually shown right now ("system" resolved), from the <html> class. */
export function useResolvedTheme(): "dark" | "light" {
  return useSyncExternalStore(subscribeHtmlClass, readResolved, () => "dark");
}
