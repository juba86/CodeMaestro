import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { orchestraPutSchema, formatZodError } from "@/lib/validation/schemas";
import { loadOrchestraConfig, saveOrchestraConfig } from "@/lib/assistant/orchestra";
import { ORCHESTRA_PRESETS } from "@/lib/assistant/orchestra-types";

export const runtime = "nodejs";

// zod issues in German (per parse — the global zod config stays untouched).
const germanErrors = z.locales.de().localeError;

// The orchestra configuration (org chart: which model plays which role).
// GET → { config, presets }; the defaults when nothing is saved yet.
export async function GET() {
  try {
    const config = await loadOrchestraConfig({ strict: true });
    return NextResponse.json({ config, presets: ORCHESTRA_PRESETS });
  } catch (err) {
    console.error("[GET orchestra]", err);
    return NextResponse.json(
      { error: "Orchester-Konfiguration konnte nicht geladen werden.", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}

// PUT { config } → validated and saved → { config }.
export async function PUT(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültiger JSON-Body.", code: "INVALID_JSON" }, { status: 400 });
  }
  const parsed = orchestraPutSchema.safeParse(body, { error: germanErrors });
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error), code: "VALIDATION_ERROR" }, { status: 400 });
  }
  try {
    const config = await saveOrchestraConfig(parsed.data.config);
    return NextResponse.json({ config });
  } catch (err) {
    console.error("[PUT orchestra]", err);
    return NextResponse.json(
      { error: "Orchester-Konfiguration konnte nicht gespeichert werden.", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
