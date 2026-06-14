import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { resolveWorkdir } from "@/lib/assistant/security";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB per file

function safeName(name: string): string {
  const base = path.basename(name).replace(/[/\\\x00]/g, "").trim();
  const clean = base.replace(/[^\w.\- ()]/g, "_");
  if (!clean || clean === "." || clean === ".." || clean.startsWith(".")) return "";
  return clean.slice(0, 200);
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

  // Optional subdirectory within the cwd (validated against the allowlist too).
  const sub = typeof form.get("dir") === "string" ? String(form.get("dir")) : "";
  let targetDir = cwd;
  if (sub) {
    try {
      const candidate = path.resolve(cwd, sub);
      targetDir = await resolveWorkdir(candidate);
    } catch {
      return NextResponse.json({ error: "Zielordner ungültig", code: "INVALID_DIR" }, { status: 400 });
    }
  }

  const saved: string[] = [];
  const skipped: string[] = [];
  for (const f of files) {
    const name = safeName(f.name);
    if (!name) { skipped.push(f.name); continue; }
    const buf = Buffer.from(await f.arrayBuffer());
    if (buf.length > MAX_BYTES) { skipped.push(`${name} (zu groß)`); continue; }
    await fs.writeFile(path.join(targetDir, name), buf);
    saved.push(name);
  }

  return NextResponse.json({ saved, skipped, dir: targetDir });
}
