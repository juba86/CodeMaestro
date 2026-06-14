/**
 * Generates a unique id. Uses crypto.randomUUID when available, but falls back
 * to a time+random id in insecure contexts (e.g. http:// on a Tailscale IP),
 * where crypto.randomUUID is undefined and would otherwise throw.
 */
export function uid(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
