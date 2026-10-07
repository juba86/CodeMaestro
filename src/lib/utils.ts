import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// `text-ui` is a custom font size (globals.css); without registering it,
// tailwind-merge treats it as a text colour and drops it next to e.g.
// `text-muted-foreground`.
const twMerge = extendTailwindMerge({ extend: { theme: { text: ["ui"] } } })

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
