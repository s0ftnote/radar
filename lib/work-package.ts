import { getBrief, type BriefRevision } from "./briefs.js";
import { listFeedback, type Feedback } from "./feedback.js";
import { listRecentJudgmentSummaries } from "./judgments.js";
import { listPendingContents, queueDepth, type PendingContent } from "./queue.js";

export type WorkPackage = {
  brief: { id: string; name: string; revision: BriefRevision };
  /** 全部反馈，原样带回——闭环靠的就是这一份（`docs/research/radar-vs-aihot.md`）。 */
  feedback: Feedback[];
  recentJudgments: Array<{ id: string; title: string; relevant: boolean; createdAt: string }>;
  pendingContents: PendingContent[];
  queueDepth: number;
};

/** 一次取齐，不再分头去要。待判断内容有上限。 */
export const defaultWorkPackageLimit = 20;

/** 一个工作包最多给这么多条。上限在服务端，客户端要不到无限长的一包。 */
export const maximumWorkPackageLimit = 200;
const recentJudgmentLimit = 50;

export function assembleWorkPackage(briefId: string, limit: number): WorkPackage {
  const brief = getBrief(briefId);
  if (!brief) throw new Error("找不到这个 Radar Brief。");

  return {
    brief: { id: brief.id, name: brief.name, revision: brief.currentRevision },
    feedback: listFeedback(briefId),
    recentJudgments: listRecentJudgmentSummaries(briefId, recentJudgmentLimit),
    pendingContents: listPendingContents(briefId, limit),
    queueDepth: queueDepth(briefId),
  };
}
