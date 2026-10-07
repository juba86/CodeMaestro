// Database seed / repair script.
//
// Run from the project root (loads .env like prisma.config.ts does, then uses
// the same DATABASE_URL resolution as the app):
//   npx jiti prisma/seed.ts
//
// Built-in templates live in code (src/lib/templates/built-in.ts) and are NOT
// stored in the database: the gallery merges them with the custom templates
// from the DB, and a DB row with the same slug overrides the built-in. Earlier
// versions of this script upserted every built-in slug with EMPTY content,
// which blanked those templates in the gallery. This script therefore seeds
// nothing; it only removes such content-less rows that shadow a built-in.
// Custom templates with real content are never touched. Safe to re-run.
// Must be the first import: the client resolves DATABASE_URL when it loads.
import "dotenv/config";
import { prisma } from "../src/lib/db/client";
import { builtInTemplates } from "../src/lib/templates/built-in";

async function main() {
  const slugs = builtInTemplates.map((t) => t.slug);
  const { count } = await prisma.template.deleteMany({
    where: { slug: { in: slugs }, content: "" },
  });
  console.log(
    count > 0
      ? `Removed ${count} empty template row(s) that shadowed built-in templates.`
      : "Nothing to do: no DB template shadows a built-in."
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
