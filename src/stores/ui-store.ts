import { useEffect } from "react";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

type ChromeFlags = { appBarHidden: boolean; tabBarHidden: boolean };

interface UIState extends ChromeFlags {
  /** Desktop sidebar expanded (true) or collapsed to the rail; persisted. */
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  /** Explicit sidebar choice per route (workspace pages default to the rail); persisted. */
  sidebarPrefs: Record<string, boolean>;
  setSidebarPref: (path: string, open: boolean) => void;
  /** Mobile shell bars hidden by screens with their own chrome (useShellChrome); not persisted. */
  setChrome: (partial: Partial<ChromeFlags>) => void;
}

type Persisted = Pick<UIState, "sidebarOpen" | "sidebarPrefs">;

/** Keeps only well-typed values from localStorage (it may be stale or edited). */
function sanitize(raw: unknown): Partial<Persisted> {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<Persisted> = {};
  if (typeof r.sidebarOpen === "boolean") out.sidebarOpen = r.sidebarOpen;
  if (r.sidebarPrefs && typeof r.sidebarPrefs === "object" && !Array.isArray(r.sidebarPrefs)) {
    const prefs: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(r.sidebarPrefs as Record<string, unknown>)) {
      if (typeof v === "boolean") prefs[k] = v;
    }
    out.sidebarPrefs = prefs;
  }
  return out;
}

// persist writes on every set(). Until rehydrate() has run (skipHydration),
// such a write would replace the saved sidebar state with the defaults — e.g.
// useShellChrome's layout effect runs before the shell's hydration effect. So
// writes wait for hydration, unchanged slices (chrome flags only) are not
// rewritten, and a blocked/full localStorage never throws into callers.
let storageReady = false;
let lastSaved: string | null = null;

const guardedLocalStorage: StateStorage = {
  getItem: (name) => {
    try {
      lastSaved = window.localStorage.getItem(name);
      return lastSaved;
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    if (!storageReady || value === lastSaved) return;
    try {
      window.localStorage.setItem(name, value);
      lastSaved = value;
    } catch {
      // Private mode / quota: keep the in-memory state.
    }
  },
  removeItem: (name) => {
    lastSaved = null;
    try {
      window.localStorage.removeItem(name);
    } catch {
      // ignore
    }
  },
};

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      sidebarPrefs: {},
      setSidebarPref: (path, open) => set((s) => ({ sidebarPrefs: { ...s.sidebarPrefs, [path]: open } })),
      appBarHidden: false,
      tabBarHidden: false,
      setChrome: (partial) =>
        set((s) => {
          const next: Partial<ChromeFlags> = {};
          if (partial.appBarHidden !== undefined && partial.appBarHidden !== s.appBarHidden) next.appBarHidden = partial.appBarHidden;
          if (partial.tabBarHidden !== undefined && partial.tabBarHidden !== s.tabBarHidden) next.tabBarHidden = partial.tabBarHidden;
          return Object.keys(next).length > 0 ? next : s;
        }),
    }),
    {
      name: "cm-ui",
      // Rehydrated by useUIStoreHydration after mount, so the server render and
      // the first client render agree (no hydration mismatch).
      skipHydration: true,
      storage: createJSONStorage(() => guardedLocalStorage),
      // Called after hydration succeeded or failed (e.g. a corrupt value), so a
      // later change can overwrite a broken entry.
      onRehydrateStorage: () => () => {
        storageReady = true;
      },
      partialize: (s): Persisted => ({ sidebarOpen: s.sidebarOpen, sidebarPrefs: s.sidebarPrefs }),
      merge: (persisted, current) => ({ ...current, ...sanitize(persisted) }),
    }
  )
);

let hydrationStarted = false;

/** Loads the persisted sidebar state once on the client. Mounted by the app shell. */
export function useUIStoreHydration(): void {
  useEffect(() => {
    if (hydrationStarted) return;
    hydrationStarted = true;
    void useUIStore.persist.rehydrate();
  }, []);
}
