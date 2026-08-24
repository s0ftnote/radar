import { NextResponse } from "next/server";
import { stopUsingSource } from "@/lib/sources";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  context: RouteContext<"/api/projects/[projectId]/sources/[sourceId]">,
) {
  try {
    const { projectId, sourceId } = await context.params;
    stopUsingSource(projectId, sourceId);
    return NextResponse.json({ message: "已停止后续采集，历史版本保留" });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "无法停止这个来源。" },
      { status: 400 },
    );
  }
}
