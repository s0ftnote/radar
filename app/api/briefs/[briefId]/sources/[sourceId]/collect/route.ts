import { NextResponse } from "next/server";
import { collectSource } from "@/lib/sources";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: RouteContext<"/api/briefs/[briefId]/sources/[sourceId]/collect">,
) {
  try {
    const { briefId, sourceId } = await context.params;
    return NextResponse.json(await collectSource(briefId, sourceId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "采集失败，请重试。" },
      { status: 400 },
    );
  }
}
