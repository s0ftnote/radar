import { NextResponse } from "next/server";
import { collectSource } from "@/lib/sources";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: RouteContext<"/api/projects/[projectId]/sources/[sourceId]/collect">,
) {
  try {
    const { projectId, sourceId } = await context.params;
    return NextResponse.json(await collectSource(projectId, sourceId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "采集失败，请重试。" },
      { status: 400 },
    );
  }
}
