import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { resolveWorkdir } from "@/lib/assistant/security";
import { promises as fs, constants as fsc } from "fs";
import path from "path";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB per file
const MAX_NAME_BYTES = 200; // filesystems cap a name at 255 bytes; leave room for " (n)"
const MAX_COLLISIONS = 1000;

// Create-only, never through a symlink: O_EXCL fails on ANY existing entry at
// the final path component (including a dangling symlink), O_NOFOLLOW is the
// belt-and-braces where the platform has it.
const CREATE_FLAGS =
  fsc.O_WRONLY | fsc.O_CREAT | fsc.O_EXCL | (fsc.O_NOFOLLOW ?? 0);

/**
 * Reduces a client-supplied file name to a safe, single path component:
 * basename only, NFC, letters/digits (incl. umlauts) and `._-() ` — everything
 * else (control chars, bidi overrides, separators) becomes "_". Dotfiles and
 * empty names are refused ("" = skip) so an upload cannot drop .env/.bashrc/.git
 * style files into a project.
 */
function safeName(name: string): string {
  const base = path.basename(name.replace(/\\/g, "/")).normalize("NFC");
  const clean = base
    .replace(/[^\p{L}\p{N}._\- ()]/gu, "_")
    .replace(/[. ]+$/, "") // trailing dots/spaces are invisible and confusing
    .trim();
  if (!clean || clean.startsWith(".")) return "";
  if (Buffer.byteLength(clean) <= MAX_NAME_BYTES) return clean;
  const ext = truncateBytes(path.extname(clean), 20);
  const stem = truncateBytes(clean.slice(0, clean.length - path.extname(clean).length), MAX_NAME_BYTES - Buffer.byteLength(ext));
  // The cut can land on a space/dot; strip again so the name never ends in one.
  return (stem + ext).replace(/[. ]+$/, "");
}

/** Longest prefix of `s` (whole code points) that fits in `max` UTF-8 bytes. */
function truncateBytes(s: string, max: number): string {
  let out = "";
  let bytes = 0;
  for (const ch of s) {
    bytes += Buffer.byteLength(ch);
    if (bytes > max) break;
    out += ch;
  }
  return out;
}

/** "report.pdf" → "report (n).pdf" */
function numbered(name: string, n: number): string {
  const ext = path.extname(name);
  return `${name.slice(0, name.length - ext.length)} (${n})${ext}`;
}

/**
 * Writes `buf` as a NEW file in `dir`, never overwriting and never following a
 * symlink. On a name collision it picks "name (1).ext", "name (2).ext", …
 * Returns the name actually used, or null when no free name was found.
 */
async function writeNewFile(dir: string, name: string, buf: Buffer): Promise<string | null> {
  for (let n = 0; n <= MAX_COLLISIONS; n++) {
    const candidate = n === 0 ? name : numbered(name, n);
    const handle = await fs.open(path.join(dir, candidate), CREATE_FLAGS, 0o644).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "EEXIST") return null;
      throw err;
    });
    if (!handle) continue;
    try {
      await handle.writeFile(buf);
    } catch (err) {
      await handle.close().catch(() => {});
      await fs.unlink(path.join(dir, candidate)).catch(() => {});
      throw err;
    }
    await handle.close();
    return candidate;
  }
  return null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await prisma.assistantSession.findUnique({ where: { id } });
  if (!session) {
    return NextResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
  }

  let cwd: string;
  try {
    cwd = await resolveWorkdir(session.cwd);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid cwd", code: "INVALID_CWD" }, { status: 400 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data", code: "INVALID_FORM" }, { status: 400 });
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "No files", code: "NO_FILES" }, { status: 400 });
  }

  // Optional subdirectory within the session cwd (real path must stay inside
  // the cwd, and resolveWorkdir re-checks the allowlist).
  const sub = typeof form.get("dir") === "string" ? String(form.get("dir")) : "";
  let targetDir = cwd;
  if (sub) {
    try {
      targetDir = await resolveWorkdir(path.resolve(cwd, sub));
      const rel = path.relative(cwd, targetDir);
      if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error("outside cwd");
    } catch {
      return NextResponse.json({ error: "Zielordner ungültig", code: "INVALID_DIR" }, { status: 400 });
    }
  }

  /** Names as actually written (may differ from the upload on collisions). */
  const saved: string[] = [];
  const renamed: { from: string; to: string }[] = [];
  const skipped: string[] = [];
  for (const f of files) {
    const name = safeName(f.name);
    if (!name) { skipped.push(`${f.name} (ungültiger Name)`); continue; }
    if (f.size > MAX_BYTES) { skipped.push(`${name} (zu groß)`); continue; }

    // Re-check the target directory right before each write: if a path
    // component was swapped for a symlink since it was validated, its real
    // path changes and we refuse instead of writing outside the allowed roots.
    try {
      if ((await fs.realpath(targetDir)) !== targetDir) throw new Error("moved");
    } catch {
      return NextResponse.json(
        { error: "Zielordner hat sich geändert", code: "INVALID_DIR", saved, renamed, skipped },
        { status: 409 }
      );
    }

    try {
      const buf = Buffer.from(await f.arrayBuffer());
      if (buf.length > MAX_BYTES) { skipped.push(`${name} (zu groß)`); continue; }
      const written = await writeNewFile(targetDir, name, buf);
      if (!written) { skipped.push(`${name} (Name bereits vergeben)`); continue; }
      saved.push(written);
      if (written !== f.name) renamed.push({ from: f.name, to: written });
    } catch (err) {
      // Error code only — messages carry absolute host paths.
      skipped.push(`${name} (${(err as NodeJS.ErrnoException).code ?? "Schreibfehler"})`);
    }
  }

  return NextResponse.json({ saved, renamed, skipped, dir: targetDir });
}
