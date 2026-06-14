import { NextRequest, NextResponse } from "next/server";
import { listWorkspaces, createWorkspace, SELECTABLE_TOOLS, PERMISSION_MODES } from "@/lib/assistant/security";

export async function GET() {
  const workspaces = await listWorkspaces();
  return NextResponse.json({
    workspaces,
    tools: SELECTABLE_TOOLS,
    permissionModes: PERMISSION_MODES,
  });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON", code: "INVALID_JSON" }, { status: 400 });
  }
  const { name, parent } = (body || {}) as { name?: string; parent?: string };
  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "Folder name required", code: "INVALID_NAME" }, { status: 400 });
  }
  try {
    const path = await createWorkspace(typeof parent === "string" ? parent : "", name);
    return NextResponse.json({ path }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not create folder", code: "CREATE_FAILED" },
      { status: 400 }
    );
  }
}
