import { NextResponse } from "next/server";
import { validateAndLinkSource } from "@/lib/sources";

export const runtime = "nodejs";

export async function POST(request: Request, context: RouteContext<"/api/projects/[projectId]/sources">) {
  try {
    const { projectId } = await context.params;
    const body = (await request.json()) as { url?: unknown };
    if (typeof body.url !== "string") {
      return NextResponse.json({ error: "请填写公开 RSS/Atom URL。" }, { status: 400 });
    }
    return NextResponse.json(await validateAndLinkSource(projectId, body.url), { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "来源没有保存，请重试。" },
      { status: 400 },
    );
  }
}
