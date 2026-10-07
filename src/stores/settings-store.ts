import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ProviderName } from "@/lib/ai/types";

interface SettingsState {
  activeProvider: ProviderName;
  activeModel: string;
  theme: "light" | "dark" | "system";
  setActiveProvider: (provider: ProviderName) => void;
  setActiveModel: (model: string) => void;
  setTheme: (theme: "light" | "dark" | "system") => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      activeProvider: "claude",
      activeModel: "claude-opus-5-5",
      theme: "dark",
      setActiveProvider: (provider) => set({ activeProvider: provider }),
      setActiveModel: (model) => set({ activeModel: model }),
      setTheme: (theme) => set({ theme }),
    }),
    { name: "prompt-builder-settings" }
  )
);
