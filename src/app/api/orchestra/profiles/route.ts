import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { formatZodError, orchestraConfigSchema } from "@/lib/validation/schemas";
import { PROFILE_NAME_MAX, ProfileLimitError, deleteProfile, listProfiles, saveProfile } from "@/lib/assistant/orchestra-profiles";

export const runtime = "nodejs";

const germanErrors = z.locales.de().localeError;
const postSchema = z.object({ name: z.string().trim().min(1).max(PROFILE_NAME_MAX), config: orchestraConfigSchema });

const failed = (err: unknown) => {
  console.error("[orchestra profiles]", err);
  return NextResponse.json({ error: "Profile konnten nicht gelesen oder gespeichert werden.", code: "INTERNAL_ERROR" }, { status: 500 });
};

// Named snapshots of the orchestra configuration. GET → { profiles }.
export async function GET() {
  try {
    return NextResponse.json({ profiles: await listProfiles() });
  } catch (err) {
    return failed(err);
  }
}

// POST { name, config } → saved under that name (replacing a profile of the same name) → { profiles }.
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültiger JSON-Body.", code: "INVALID_JSON" }, { status: 400 });
  }
  const parsed = postSchema.safeParse(body, { error: germanErrors });
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error), code: "VALIDATION_ERROR" }, { status: 400 });
  }
  try {
    return NextResponse.json({ profiles: await saveProfile(parsed.data.name, parsed.data.config) });
  } catch (err) {
    if (err instanceof ProfileLimitError) return NextResponse.json({ error: err.message, code: "LIMIT" }, { status: 409 });
    return failed(err);
  }
}

// DELETE ?id=… → { profiles }.
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "Profil fehlt.", code: "VALIDATION_ERROR" }, { status: 400 });
  try {
    return NextResponse.json({ profiles: await deleteProfile(id) });
  } catch (err) {
    return failed(err);
  }
}
