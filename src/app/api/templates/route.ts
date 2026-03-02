import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { createTemplateSchema, formatZodError } from "@/lib/validation/schemas";

export async function GET(req: NextRequest) {
  const category = req.nextUrl.searchParams.get("category") || "";

  const where = category ? { category } : {};

  const templates = await prisma.template.findMany({
    where,
    orderBy: [{ isBuiltIn: "desc" }, { name: "asc" }],
  });

  return NextResponse.json({ templates });
}

export async function POST(req: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body", code: "INVALID_JSON" },
        { status: 400 }
      );
    }

    const result = createTemplateSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: formatZodError(result.error), code: "VALIDATION_ERROR" },
        { status: 400 }
      );
    }

    const { slug, name, description, category, content, structured, isBuiltIn } = result.data;

    const template = await prisma.template.create({
      data: { slug, name, description, category, content, structured, isBuiltIn },
    });

    return NextResponse.json({ template }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/templates]", err);
    return NextResponse.json(
      { error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
