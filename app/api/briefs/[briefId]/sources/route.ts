import { NextResponse } from "next/server";
import { linkSavedSource, validateAndLinkSource } from "@/lib/sources";

export const runtime = "nodejs";

export async function POST(request: Request, context: RouteContext<"/api/briefs/[briefId]/sources">) {
  try {
    const { briefId } = await context.params;
    const body = (await request.json()) as { url?: unknown; sourceId?: unknown };
    if (typeof body.sourceId === "string") {
      return NextResponse.json(linkSavedSource(briefId, body.sourceId), { status: 201 });
    }
    if (typeof body.url === "string") {
      return NextResponse.json(await validateAndLinkSource(briefId, body.url), { status: 201 });
    }
    return NextResponse.json({ error: "请选择已保存来源，或填写公开 RSS/Atom URL。" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "来源没有保存，请重试。" },
      { status: 400 },
    );
  }
}
