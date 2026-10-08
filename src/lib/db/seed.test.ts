// End-to-end check of prisma/seed.ts as it is really run: a separate process
// (the npm script / the command prisma.config.ts gives `prisma db seed`)
// against a throwaway SQLite file. Vitest resolves the "@/…" alias itself, so
// only a real run catches a seed that cannot load the app modules it imports.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, execSync } from "child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import Database from "better-sqlite3";

const ROOT = path.resolve(__dirname, "../../..");
const dir = mkdtempSync(path.join(tmpdir(), "cm-seed-"));
const dbFile = path.join(dir, "seed.db");
const env = { ...process.env, DATABASE_URL: `file:${dbFile}` };
const stdio: ["ignore", "pipe", "pipe"] = ["ignore", "pipe", "pipe"];

function templates(): Array<{ slug: string; content: string }> {
  const db = new Database(dbFile, { readonly: true });
  try {
    return db.prepare("SELECT slug, content FROM Template ORDER BY slug").all() as Array<{ slug: string; content: string }>;
  } finally {
    db.close();
  }
}

beforeAll(() => {
  // Same schema as `prisma migrate deploy`, applied without the Prisma CLI.
  const db = new Database(dbFile);
  const migrations = path.join(ROOT, "prisma", "migrations");
  for (const m of readdirSync(migrations, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    db.exec(readFileSync(path.join(migrations, m, "migration.sql"), "utf8"));
  }
  const insert = db.prepare("INSERT INTO Template (id, slug, name, content, updatedAt) VALUES (?, ?, ?, ?, ?)");
  insert.run("t1", "code-review", "leerer Schatten", "", Date.now()); // shadows a built-in → removed
  insert.run("t2", "debugging", "eigene Version", "<task/>", Date.now()); // real override → kept
  insert.run("t3", "mein-template", "eigenes, leer", "", Date.now()); // not a built-in slug → kept
  db.close();
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("prisma/seed.ts", () => {
  it("runs via the prisma.config.ts seed command and only removes empty rows shadowing a built-in", () => {
    const config = readFileSync(path.join(ROOT, "prisma.config.ts"), "utf8");
    const seedCmd = /\bseed:\s*"([^"]+)"/.exec(config)?.[1];
    expect(seedCmd).toBeTruthy();
    const out = execSync(seedCmd!, { cwd: ROOT, env, encoding: "utf8", stdio });
    expect(out).toContain("Removed 1 empty template row(s)");
    expect(templates()).toEqual([
      { slug: "debugging", content: "<task/>" },
      { slug: "mein-template", content: "" },
    ]);
  }, 60_000);

  it("is safe to re-run via `npm run db:seed`", () => {
    const out = execFileSync("npm", ["run", "--silent", "db:seed"], { cwd: ROOT, env, encoding: "utf8", stdio });
    expect(out).toContain("Nothing to do");
    expect(templates()).toHaveLength(2);
  }, 60_000);
});
