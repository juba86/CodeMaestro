import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { formatZodError } from "@/lib/validation/schemas";
import { disconnect, getGithubStatus, githubErrorInfo, updateGithubOptions } from "@/lib/github";

export const runtime = "nodejs";

const CLIENT_ID = /^[A-Za-z0-9._-]{8,64}$/;

const optionsSchema = z.strictObject(
  {
    injectIntoAssistant: z.boolean({ error: "Muss true oder false sein." }).optional(),
    gitIdentity: z.boolean({ error: "Muss true oder false sein." }).optional(),
    oauthClientId: z
      .string({ error: "Muss ein Text sein." })
      .trim()
      .refine((v) => v === "" || CLIENT_ID.test(v), "Ungültige Client-ID.")
      .optional(),
  },
  { error: (iss) => (iss.code === "unrecognized_keys" ? "Unbekanntes Feld." : "Ungültige Anfrage.") }
);

function fail(err: unknown) {
  const { status, error, code } = githubErrorInfo(err);
  return NextResponse.json({ error, code }, { status });
}

// Connection status (never includes the token).
export async function GET() {
  try {
    return NextResponse.json({ status: await getGithubStatus() });
  } catch (err) {
    return fail(err);
  }
}

// Options: inject into assistant runs, git identity, saved OAuth client id.
export async function PATCH(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültiges JSON.", code: "INVALID_JSON" }, { status: 400 });
  }
  const parsed = optionsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error), code: "VALIDATION_ERROR" }, { status: 400 });
  }
  try {
    return NextResponse.json({ status: await updateGithubOptions(parsed.data) });
  } catch (err) {
    return fail(err);
  }
}

// Forget the token locally (revoking it on GitHub is up to the user).
export async function DELETE() {
  try {
    return NextResponse.json({ status: await disconnect() });
  } catch (err) {
    return fail(err);
  }
}
