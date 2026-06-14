import { prisma } from "@/lib/db/client";

/** Reads a server-side setting (stored as a JSON string), with a fallback. */
export async function getSetting(key: string, fallback = ""): Promise<string> {
  try {
    const row = await prisma.setting.findUnique({ where: { key } });
    if (!row) return fallback;
    try {
      return JSON.parse(row.value);
    } catch {
      return row.value;
    }
  } catch {
    return fallback;
  }
}

export async function setSetting(key: string, value: string): Promise<void> {
  const val = JSON.stringify(value);
  await prisma.setting.upsert({
    where: { key },
    update: { value: val },
    create: { key, value: val },
  });
}
