import { NextResponse } from "next/server";
import { listJudgments, listPendingContents, recordJudgment } from "@/lib/judgments";

export const runtime = "nodejs";

/** 判断角色读取待判断队列，取数角色读取已判断的内容。 */
export async function GET(
  _request: Request,
  context: RouteContext<"/api/briefs/[briefId]/judgments">,
) {
  try {
    const { briefId } = await context.params;
    return NextResponse.json({
      pendingContents: listPendingContents(briefId),
      judgments: listJudgments(briefId),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "无法读取这个 Radar Brief 的判断。" },
      { status: 400 },
    );
  }
}

/** Agent 把一次判定写回 Radar。 */
export async function POST(
  request: Request,
  context: RouteContext<"/api/briefs/[briefId]/judgments">,
) {
  try {
    const { briefId } = await context.params;
    const body: unknown = await request.json();
    if (!isJudgmentRequest(body)) {
      return NextResponse.json(
        { error: "一次判断需要 sourceContentId、relevant 与一段给用户的理由。" },
        { status: 400 },
      );
    }
    return NextResponse.json(
      recordJudgment(briefId, {
        sourceContentId: body.sourceContentId,
        relevant: body.relevant,
        reason: body.reason.trim(),
        signalContentIds: body.signalContentIds,
      }),
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "判断没有写回，请重试。" },
      { status: 400 },
    );
  }
}

function isJudgmentRequest(value: unknown): value is {
  sourceContentId: string;
  relevant: boolean;
  reason: string;
  signalContentIds?: string[];
} {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.sourceContentId !== "string" || !candidate.sourceContentId) return false;
  if (typeof candidate.relevant !== "boolean") return false;
  if (typeof candidate.reason !== "string" || !candidate.reason.trim()) return false;
  if (candidate.signalContentIds !== undefined) {
    if (!Array.isArray(candidate.signalContentIds)) return false;
    if (candidate.signalContentIds.some((id) => typeof id !== "string" || !id)) return false;
  }
  return true;
}
