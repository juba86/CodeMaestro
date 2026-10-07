import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { formatZodError } from "@/lib/validation/schemas";
import { githubErrorInfo, startDeviceFlow } from "@/lib/github";

export const runtime = "nodejs";

const startSchema = z.object(
  {
    // Falls back to the saved client id, then GITHUB_OAUTH_CLIENT_ID.
    clientId: z
      .string({ error: "Client-ID muss ein Text sein." })
      .trim()
      .refine((v) => v === "" || /^[A-Za-z0-9._-]{8,64}$/.test(v), "Ungültige Client-ID.")
      .optional(),
  },
  { error: "Ungültige Anfrage." }
);

// Start the OAuth device flow. The device_code stays on the server; the client
// gets an opaque flowId plus the code the user types on github.com.
export async function POST(req: NextRequest) {
  let body: unknown = {};
  try {
    const text = await req.text();
    if (text.trim()) body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Ungültiges JSON.", code: "INVALID_JSON" }, { status: 400 });
  }
  const parsed = startSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error), code: "VALIDATION_ERROR" }, { status: 400 });
  }
  try {
    return NextResponse.json(await startDeviceFlow(parsed.data.clientId || undefined));
  } catch (err) {
    const { status, error, code } = githubErrorInfo(err);
    return NextResponse.json({ error, code }, { status });
  }
}
