import { NextResponse } from "next/server";
import { createProject } from "@/lib/projects";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    if (!isProjectRequest(body)) {
      return NextResponse.json(
        { error: "请填写 Project 名称和一段完整的 Radar Brief。" },
        { status: 400 },
      );
    }

    const project = createProject({ name: body.name.trim(), brief: body.brief.trim() });
    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    console.error("[Radar] 创建 Project 失败：", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: "Project 没有保存。请确认本地数据目录可写后重试。" },
      { status: 500 },
    );
  }
}

function isProjectRequest(value: unknown): value is { name: string; brief: string } {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.name === "string" &&
    candidate.name.trim().length >= 2 &&
    candidate.name.trim().length <= 80 &&
    typeof candidate.brief === "string" &&
    candidate.brief.trim().length >= 10 &&
    candidate.brief.trim().length <= 2_000
  );
}
