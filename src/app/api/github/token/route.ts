import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { formatZodError } from "@/lib/validation/schemas";
import { connectWithToken, githubErrorInfo } from "@/lib/github";

export const runtime = "nodejs";

const tokenSchema = z.object(
  {
    token: z
      .string({ error: "Token fehlt." })
      .trim()
      .min(20, "Token zu kurz.")
      .max(255, "Token zu lang.")
      .regex(/^[A-Za-z0-9_]+$/, "Token enthält ungültige Zeichen."),
  },
  { error: "Ungültige Anfrage." }
);

// Connect with a personal access token: validated against GitHub, stored encrypted.
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültiges JSON.", code: "INVALID_JSON" }, { status: 400 });
  }
  const parsed = tokenSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error), code: "VALIDATION_ERROR" }, { status: 400 });
  }
  try {
    return NextResponse.json({ status: await connectWithToken(parsed.data.token) });
  } catch (err) {
    const { status, error, code } = githubErrorInfo(err);
    return NextResponse.json({ error, code }, { status });
  }
}
