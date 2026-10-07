import { NextResponse } from "next/server";
import { githubErrorInfo, testGithubConnection } from "@/lib/github";

export const runtime = "nodejs";

// Proves the stored token works: up to 5 recently pushed repos with push rights.
export async function POST() {
  try {
    return NextResponse.json({ ok: true, ...(await testGithubConnection()) });
  } catch (err) {
    const { status, error, code } = githubErrorInfo(err);
    return NextResponse.json({ ok: false, error, code }, { status });
  }
}
