import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { orchestraPresetSchema, formatZodError } from "@/lib/validation/schemas";
import { generatePreset } from "@/lib/assistant/orchestra";

export const runtime = "nodejs";

// zod issues in German (per parse — the global zod config stays untouched).
const germanErrors = z.locales.de().localeError;

// POST { preset: "quality"|"balanced"|"local", clientProviders?, config? } →
// { config, warnings }. Computes the assignments from the workers available
// now and returns them WITHOUT saving (the UI shows them; PUT /api/orchestra
// saves). With `config`, the user's roles are kept and only the models change.
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültiger JSON-Body.", code: "INVALID_JSON" }, { status: 400 });
  }
  const parsed = orchestraPresetSchema.safeParse(body, { error: germanErrors });
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error), code: "VALIDATION_ERROR" }, { status: 400 });
  }
  const { preset, clientProviders, config } = parsed.data;
  try {
    const result = await generatePreset(preset, clientProviders, config);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[POST orchestra/preset]", err);
    return NextResponse.json(
      { error: "Voreinstellung konnte nicht berechnet werden (Modell-Erkennung fehlgeschlagen).", code: "PRESET_FAILED" },
      { status: 500 }
    );
  }
}
