import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { formatZodError } from "@/lib/validation/schemas";
import { cancelDeviceFlow, getGithubStatus, githubErrorInfo, pollDeviceFlow } from "@/lib/github";

export const runtime = "nodejs";

const pollSchema = z.object(
  {
    flowId: z.uuid({ error: "Ungültige Flow-ID." }),
    cancel: z.boolean({ error: "Muss true oder false sein." }).optional(),
  },
  { error: "Ungültige Anfrage." }
);

// Poll a running device flow. The server enforces GitHub's interval, so
// polling too often just returns "pending". `cancel: true` drops the flow.
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültiges JSON.", code: "INVALID_JSON" }, { status: 400 });
  }
  const parsed = pollSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error), code: "VALIDATION_ERROR" }, { status: 400 });
  }
  if (parsed.data.cancel) {
    cancelDeviceFlow(parsed.data.flowId);
    return NextResponse.json({ status: "expired", message: "Abgebrochen." });
  }
  try {
    const result = await pollDeviceFlow(parsed.data.flowId);
    if (result.status === "connected") {
      return NextResponse.json({ ...result, github: await getGithubStatus() });
    }
    return NextResponse.json(result);
  } catch (err) {
    const { status, error, code } = githubErrorInfo(err);
    return NextResponse.json({ error, code }, { status });
  }
}
