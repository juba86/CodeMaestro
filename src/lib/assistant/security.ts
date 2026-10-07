import path from "path";
import { promises as fs } from "fs";

// Roots the assistant is allowed to operate in. Configurable via env
// ASSISTANT_ALLOWED_DIRS (colon-separated). Defaults to the parent of the app
// directory (i.e. the "apps" folder), so the assistant can work on sibling
// projects but cannot escape to arbitrary paths on the host.
export function allowedRoots(): string[] {
  const env = process.env.ASSISTANT_ALLOWED_DIRS;
  if (env && env.trim()) {
    // Drop empty segments BEFORE resolving: path.resolve("") is the process
    // cwd, so "a::b" or a trailing ":" would silently allow the app directory.
    return env.split(":").map((p) => p.trim()).filter(Boolean).map((p) => path.resolve(p));
  }
  return [path.resolve(process.cwd(), "..")];
}

// Configured root → its real path, resolved ONCE per process. Re-resolving on
// every check would let anything that can later swap a root (or a missing
// root's path) for a symlink — e.g. an agent with nested roots — silently widen
// the allowlist to the link target. Pinned, a swapped root just stops matching.
const realRootCache = new Map<string, string>();

/**
 * The allowed roots with symlinks resolved. Targets are compared by their real
 * path, so the roots must be too — otherwise a symlinked root (e.g. macOS
 * /tmp → /private/tmp, or a symlinked projects folder) rejects everything
 * inside it. A root that does not exist at first use keeps its resolved path
 * (until restart).
 */
export async function realAllowedRoots(): Promise<string[]> {
  const roots = await Promise.all(
    allowedRoots().map(async (r) => {
      let real = realRootCache.get(r);
      if (real === undefined) {
        real = await fs.realpath(r).catch(() => r);
        realRootCache.set(r, real);
      }
      return real;
    })
  );
  return [...new Set(roots)];
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/**
 * Resolves and validates a requested working directory against the allowlist.
 * Returns the real absolute path, or throws if it escapes the allowed roots or
 * is not an existing directory. This is the core sandboxing guard — the client
 * may only run the assistant inside approved directories.
 */
export async function resolveWorkdir(requested?: string): Promise<string> {
  const roots = await realAllowedRoots();
  const target = requested && requested.trim()
    ? path.resolve(requested.trim())
    : roots[0];

  let real: string;
  try {
    real = await fs.realpath(target);
  } catch {
    throw new Error(`Working directory does not exist: ${target}`);
  }

  const stat = await fs.stat(real);
  if (!stat.isDirectory()) {
    throw new Error(`Not a directory: ${real}`);
  }

  const ok = roots.some((root) => isInside(real, root));
  if (!ok) {
    throw new Error(`Working directory is outside the allowed roots: ${real}`);
  }
  return real;
}

/**
 * Creates a new subdirectory under `parent` (which must itself be inside the
 * allowed roots). The folder name is sanitized and the resulting path is
 * re-checked against the allowlist. Returns the new absolute path.
 */
export async function createWorkspace(parent: string, name: string): Promise<string> {
  const roots = await realAllowedRoots();
  let parentReal: string;
  try {
    parentReal = await fs.realpath(path.resolve(parent && parent.trim() ? parent : roots[0]));
  } catch {
    throw new Error("Parent directory does not exist.");
  }
  if (!roots.some((r) => isInside(parentReal, r))) {
    throw new Error("Parent is outside the allowed roots.");
  }
  const clean = name.trim().replace(/[/\\]/g, "");
  if (!clean || clean === "." || clean === ".." || clean.startsWith(".")) {
    throw new Error("Invalid folder name.");
  }
  const target = path.join(parentReal, clean);
  if (!roots.some((r) => isInside(target, r))) {
    throw new Error("Target is outside the allowed roots.");
  }
  await fs.mkdir(target, { recursive: true });
  // The name may already exist as a symlink pointing elsewhere: re-check the
  // real path of what we are about to hand out.
  const real = await fs.realpath(target);
  if (!roots.some((r) => isInside(real, r))) {
    throw new Error("Target is outside the allowed roots.");
  }
  return real;
}

/**
 * Lists the subdirectories of a directory for the folder browser, confined to the
 * allowed roots. Returns the resolved path, its parent (null if leaving the
 * allowlist), and the immediate child directories.
 */
export async function browseDir(requested?: string): Promise<{
  path: string;
  parent: string | null;
  dirs: { name: string; path: string }[];
}> {
  const roots = await realAllowedRoots();
  const target = requested && requested.trim() ? path.resolve(requested.trim()) : roots[0];

  let real: string;
  try {
    real = await fs.realpath(target);
  } catch {
    throw new Error("Directory does not exist.");
  }
  const stat = await fs.stat(real);
  if (!stat.isDirectory()) throw new Error("Not a directory.");
  if (!roots.some((r) => isInside(real, r))) {
    throw new Error("Directory is outside the allowed roots.");
  }

  const parentPath = path.dirname(real);
  const parent =
    parentPath !== real && roots.some((r) => isInside(parentPath, r)) ? parentPath : null;

  let dirs: { name: string; path: string }[] = [];
  try {
    const entries = await fs.readdir(real, { withFileTypes: true });
    dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => ({ name: e.name, path: path.join(real, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    /* unreadable — return empty */
  }
  return { path: real, parent, dirs };
}

/** Lists the allowed roots and their immediate subdirectories as pickable workspaces. */
export async function listWorkspaces(): Promise<{ path: string; label: string }[]> {
  const roots = await realAllowedRoots();
  const out: { path: string; label: string }[] = [];
  const seen = new Set<string>();

  for (const root of roots) {
    if (!seen.has(root)) {
      seen.add(root);
      out.push({ path: root, label: root });
    }
    try {
      const entries = await fs.readdir(root, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory() && !e.name.startsWith(".")) {
          const full = path.join(root, e.name);
          if (!seen.has(full)) {
            seen.add(full);
            out.push({ path: full, label: full });
          }
        }
      }
    } catch {
      /* ignore unreadable roots */
    }
  }
  return out;
}

// Tools that are never auto-allowed via the simple allowlist UI (still usable in
// permission modes that prompt, which we don't expose headless). Kept minimal.
export const SELECTABLE_TOOLS = ["Read", "Grep", "Glob", "Bash", "Edit", "Write", "WebSearch", "WebFetch"];
export const PERMISSION_MODES = ["default", "acceptEdits", "plan", "bypassPermissions"];
