import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * `cn` for the primitives. Same as `@/lib/utils` plus the `text-ui` font size
 * from globals.css: stock tailwind-merge does not know it, treats it as a text
 * colour and drops it next to e.g. `text-muted-foreground`.
 * TODO: once `@/lib/utils` uses this config, re-export it from there.
 */
const twMerge = extendTailwindMerge({ extend: { theme: { text: ["ui"] } } });

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
