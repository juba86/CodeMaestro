import { NextResponse } from "next/server";
import { githubErrorInfo, listGithubRepos } from "@/lib/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The connected account's repositories, most recently pushed first (prompt builder).
export async function GET() {
  try {
    return NextResponse.json({ repos: await listGithubRepos() });
  } catch (err) {
    const { status, error, code } = githubErrorInfo(err);
    return NextResponse.json({ error, code }, { status });
  }
}
