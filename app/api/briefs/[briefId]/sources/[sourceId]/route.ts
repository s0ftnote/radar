import { NextResponse } from "next/server";
import { stopUsingSource } from "@/lib/sources";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  context: RouteContext<"/api/briefs/[briefId]/sources/[sourceId]">,
) {
  try {
    const { briefId, sourceId } = await context.params;
    stopUsingSource(briefId, sourceId);
    return NextResponse.json({ message: "已停止后续采集，已取得的来源内容保留" });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "无法停止这个来源。" },
      { status: 400 },
    );
  }
}
