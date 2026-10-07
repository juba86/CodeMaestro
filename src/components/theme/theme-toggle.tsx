"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import { IconButton, type IconButtonProps } from "@/components/ui/button";
import { SegmentedControl, SegmentedItem } from "@/components/ui/segmented-control";

export type ThemeChoice = "dark" | "light" | "system";

export const THEME_LABEL: Record<ThemeChoice, string> = { dark: "Dunkel", light: "Hell", system: "System" };
const NEXT: Record<ThemeChoice, ThemeChoice> = { dark: "light", light: "system", system: "dark" };
const ICON = { dark: Moon, light: Sun, system: Monitor } as const;

const noop = () => () => {};

/** The persisted store is only read after hydration, so server and client markup match. */
function useStoredTheme(): [ThemeChoice, (t: ThemeChoice) => void] {
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  return [hydrated ? theme : "dark", setTheme];
}

/** Next theme in the cycle Dunkel → Hell → System. */
export function nextTheme(t: ThemeChoice): ThemeChoice {
  return NEXT[t];
}

/** Icon button cycling Dunkel → Hell → System; the label names the current and the next state. */
export function ThemeToggle(props: Omit<IconButtonProps, "aria-label" | "onClick" | "children">) {
  const [theme, setTheme] = useStoredTheme();
  const next = NEXT[theme];
  const Icon = ICON[theme];
  return (
    <IconButton
      aria-label={`Design: ${THEME_LABEL[theme]}. Wechseln zu ${THEME_LABEL[next]}`}
      tooltip={`Design: ${THEME_LABEL[theme]}`}
      onClick={() => setTheme(next)}
      {...props}
    >
      <Icon />
    </IconButton>
  );
}

/** System / Dunkel / Hell as a segmented control (Settings → Allgemein, Mehr sheet). */
export function ThemeSegmented({
  size = "md",
  className,
  stretch,
}: {
  size?: "sm" | "md";
  className?: string;
  stretch?: boolean;
}) {
  const [theme, setTheme] = useStoredTheme();
  return (
    <SegmentedControl
      aria-label="Design"
      size={size}
      stretch={stretch}
      className={className}
      value={theme}
      onValueChange={(v) => setTheme(v as ThemeChoice)}
    >
      <SegmentedItem value="system" icon={<Monitor />}>
        System
      </SegmentedItem>
      <SegmentedItem value="dark" icon={<Moon />}>
        Dunkel
      </SegmentedItem>
      <SegmentedItem value="light" icon={<Sun />}>
        Hell
      </SegmentedItem>
    </SegmentedControl>
  );
}
