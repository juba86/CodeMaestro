"use client";

import { useSyncExternalStore } from "react";
import { isApplePlatform } from "@/lib/hotkeys";
import { hostLabel } from "./activity-format";

const noop = () => () => {};

/** ⌘ on Apple devices, Ctrl elsewhere; null until hydrated (the server cannot know). */
export function useIsApple(): boolean | null {
  return useSyncExternalStore(
    noop,
    () => isApplePlatform(navigator),
    () => null,
  );
}

/** Short server name from `location.hostname` ("noba-server"); "" on the server. */
export function useHostLabel(): string {
  return useSyncExternalStore(
    noop,
    () => hostLabel(window.location.hostname),
    () => "",
  );
}

/** "⌘K" on Apple devices, "Strg K" elsewhere. */
export function modKeyLabel(isApple: boolean, key: string): string {
  return isApple ? `⌘${key}` : `Strg ${key}`;
}
