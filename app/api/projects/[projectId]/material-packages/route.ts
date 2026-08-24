import { NextResponse } from "next/server";
import {
  createHtmlMaterialPackage,
  retryHtmlMaterialPackage,
} from "@/lib/material-packages";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    if (typeof body.retryRunId === "string") {
      return NextResponse.json(await retryHtmlMaterialPackage(projectId, body.retryRunId), { status: 201 });
    }
    if (typeof body.reportRevisionId === "string") {
      return NextResponse.json(await createHtmlMaterialPackage(projectId, body.reportRevisionId), { status: 201 });
    }
    return NextResponse.json(
      { error: "请选择一份成功 Report，或指定需要重试的失败运行。" },
      { status: 400 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "HTML 物料包生成失败，可以重试。" },
      { status: 400 },
    );
  }
}
