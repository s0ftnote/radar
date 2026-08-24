import { NextResponse } from "next/server";
import { runProjectJudgment } from "@/lib/intelligence";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: RouteContext<"/api/projects/[projectId]/judgments">,
) {
  try {
    const { projectId } = await context.params;
    return NextResponse.json(await runProjectJudgment(projectId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Radar 判断没有完成，请重试。" },
      { status: 400 },
    );
  }
}
