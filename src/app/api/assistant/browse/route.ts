import { NextRequest, NextResponse } from "next/server";
import { browseDir } from "@/lib/assistant/security";

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path") || "";
  try {
    const result = await browseDir(path);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not browse", code: "BROWSE_FAILED" },
      { status: 400 }
    );
  }
}
