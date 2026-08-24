import { NextResponse } from "next/server";
import { generateManualReport, retryReportGeneration } from "@/lib/reports";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    if (typeof body.retryRunId === "string") {
      return NextResponse.json(await retryReportGeneration(projectId, body.retryRunId));
    }
    if (
      typeof body.purpose !== "string"
      || typeof body.audience !== "string"
      || typeof body.angle !== "string"
      || !Array.isArray(body.intelligenceItemRevisionIds)
      || body.intelligenceItemRevisionIds.some((id) => typeof id !== "string")
    ) {
      return NextResponse.json({ error: "请完成 Report 输入并至少选择一个情报条目。" }, { status: 400 });
    }
    return NextResponse.json(await generateManualReport(projectId, {
      purpose: body.purpose,
      audience: body.audience,
      angle: body.angle,
      intelligenceItemRevisionIds: body.intelligenceItemRevisionIds as string[],
    }), { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Report 生成失败，可以重试。" },
      { status: 400 },
    );
  }
}
