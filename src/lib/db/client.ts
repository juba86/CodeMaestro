// Relative import (not "@/…") so standalone scripts (prisma/seed.ts) can reuse
// this module without a path-alias aware loader.
import { PrismaClient } from "../../generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

/**
 * Resolves the SQLite file the app runs against from DATABASE_URL — the same
 * variable prisma.config.ts hands to `prisma migrate`, so runtime and
 * migrations always hit the same file.
 *
 * Resolution matches Prisma 7's CLI (verified with `migrate deploy`):
 * - unset/empty            → <cwd>/dev.db (historic default)
 * - file:/abs, file:///abs → that absolute path
 * - file:./x.db, file:x.db → relative to the directory of prisma.config.ts,
 *   i.e. the project root. The app (next dev/start) and the Prisma CLI both run
 *   from there, so it is resolved against process.cwd().
 * - "?…" parameters (e.g. ?connection_limit=1) are ignored, as Prisma does.
 * Anything that is not a file: URL is rejected: this client is SQLite-only and
 * silently falling back to another file would split data from migrations.
 */
export function resolveDatabaseFile(url = process.env.DATABASE_URL): string {
  const raw = url?.trim() ?? "";
  if (!raw) return path.join(process.cwd(), "dev.db");
  if (!raw.startsWith("file:")) {
    throw new Error(`DATABASE_URL must be a SQLite "file:" URL (got "${raw.split(":")[0]}:…").`);
  }
  const noParams = raw.split(/[?#]/)[0];
  const file = noParams.startsWith("file://")
    ? fileURLToPath(noParams)
    : noParams.slice("file:".length);
  if (!file) throw new Error("DATABASE_URL has an empty file path.");
  return path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);
}

function makePrisma(): PrismaClient {
  const file = resolveDatabaseFile();
  // Earlier versions always used <cwd>/dev.db and ignored DATABASE_URL. If it
  // now points elsewhere while that file exists, the existing data stays in
  // the old file — say so instead of letting it look lost.
  const legacy = path.join(process.cwd(), "dev.db");
  if (file !== legacy && existsSync(legacy)) {
    console.warn(
      `[db] Using DATABASE_URL → ${file}, but ${legacy} also exists (earlier versions ` +
        `always used it). If data seems missing, set DATABASE_URL="file:./dev.db".`
    );
  }
  // better-sqlite3's own busy timeout (5 s) applies; `timeout` is explicit so a
  // reader never fails with SQLITE_BUSY while a run writes transcript rows.
  const adapter = new PrismaBetterSqlite3({ url: `file:${file}`, timeout: 5_000 });
  const client = new PrismaClient({ adapter });
  void applyPragmas(client);
  return client;
}

/**
 * Write-ahead logging: readers (the polling routes) no longer block the run
 * that streams transcript rows, and each committed row costs one small WAL
 * append instead of a rollback-journal rewrite. `journal_mode` is persisted
 * in the database file, so this is a one-time switch that later connections
 * (including the Prisma CLI) inherit. Per-connection pragmas such as
 * `synchronous` cannot be set here: the adapter runs raw statements inside a
 * transaction, where SQLite refuses to change them.
 */
async function applyPragmas(client: PrismaClient): Promise<void> {
  try {
    await client.$queryRawUnsafe("PRAGMA journal_mode = WAL");
  } catch (err) {
    console.warn("[db] SQLite pragmas could not be applied:", err instanceof Error ? err.message : err);
  }
}

export const prisma = globalForPrisma.prisma || makePrisma();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
