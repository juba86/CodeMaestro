import { NextRequest, NextResponse } from "next/server";
import { githubErrorInfo, githubRepoBrief } from "@/lib/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One repository as prompt context: ?repo=owner/name → metadata, root listing, README start.
export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({ repo: await githubRepoBrief(req.nextUrl.searchParams.get("repo") ?? "") });
  } catch (err) {
    const { status, error, code } = githubErrorInfo(err);
    return NextResponse.json({ error, code }, { status });
  }
}
