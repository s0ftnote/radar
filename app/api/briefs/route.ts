import { NextResponse } from "next/server";
import { createBrief } from "@/lib/briefs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    if (!isBriefRequest(body)) {
      return NextResponse.json(
        { error: "请填写 Brief 名称和一段完整的 Radar Brief。" },
        { status: 400 },
      );
    }

    const brief = createBrief({
      name: body.name.trim(),
      description: body.description.trim(),
    });
    return NextResponse.json(brief, { status: 201 });
  } catch (error) {
    console.error("[Radar] 创建 Radar Brief 失败：", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: "Radar Brief 没有保存。请确认本地数据目录可写后重试。" },
      { status: 500 },
    );
  }
}

function isBriefRequest(value: unknown): value is { name: string; description: string } {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.name === "string" &&
    candidate.name.trim().length >= 2 &&
    candidate.name.trim().length <= 80 &&
    typeof candidate.description === "string" &&
    candidate.description.trim().length >= 10 &&
    candidate.description.trim().length <= 2_000
  );
}
