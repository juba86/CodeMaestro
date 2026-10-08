"use client";

// Status hints for the settings section nav and the mobile index (GitHub dot,
// Telegram „aktiv", pi dot). The nav loads them once; the sections publish
// fresh values whenever they change something (connect, save, re-sync), so the
// nav never shows a stale state next to the section that just changed it.

import { useSyncExternalStore } from "react";

export interface GithubHint {
  connected: boolean;
  tokenReadable: boolean;
  login: string | null;
}

export interface TelegramHint {
  running: boolean;
  botUsername: string;
}

export interface PiHint {
  installed: boolean;
  /** Sync or probe error text ("" when fine). */
  error: string;
}

export interface SettingsHints {
  /** undefined = not loaded yet, null = could not be loaded. */
  github: GithubHint | null | undefined;
  telegram: TelegramHint | null | undefined;
  pi: PiHint | null | undefined;
}

const INITIAL: SettingsHints = { github: undefined, telegram: undefined, pi: undefined };
let hints: SettingsHints = INITIAL;
const listeners = new Set<() => void>();

function patch(next: Partial<SettingsHints>) {
  hints = { ...hints, ...next };
  for (const l of listeners) l();
}

export function publishGithubHint(s: GithubHint | null) {
  patch({ github: s ? { connected: s.connected, tokenReadable: s.tokenReadable, login: s.login } : null });
}

export function publishTelegramHint(s: TelegramHint | null) {
  patch({ telegram: s ? { running: s.running, botUsername: s.botUsername } : null });
}

export function publishPiHint(s: PiHint | null) {
  patch({ pi: s ? { installed: s.installed, error: s.error } : null });
}

async function getJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

/** (Re)loads all hints, each source independently (the settings page calls it on mount). */
export function loadSettingsHints() {
  getJson("/api/github")
    .then((d) => publishGithubHint((d.status as GithubHint | undefined) ?? null))
    .catch(() => publishGithubHint(null));
  getJson("/api/assistant/telegram")
    .then((d) => publishTelegramHint((d.status as TelegramHint | undefined) ?? null))
    .catch(() => publishTelegramHint(null));
  getJson("/api/assistant/pi")
    .then((d) =>
      publishPiHint(
        typeof d.installed === "boolean" ? { installed: d.installed, error: typeof d.error === "string" ? d.error : "" } : null,
      ),
    )
    .catch(() => publishPiHint(null));
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const getSnapshot = () => hints;
const getServerSnapshot = () => INITIAL;

export function useSettingsHints(): SettingsHints {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
