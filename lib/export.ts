import { getBrief, listBriefRevisions, UnknownBriefError, type BriefRevision } from "./briefs.js";
import { database } from "./database.js";
import { listDeliveries, type Delivery } from "./deliveries.js";
import { listFeedback, type Feedback } from "./feedback.js";
import { listJudgments, type Judgment } from "./judgments.js";

/**
 * 完整导出：用户从一个实例带走的档案。同时给两样东西——一份可机读的结构，
 * 和一份不装任何东西就能读的正文。
 *
 * 单个 Brief 的导出**不依赖其他 Brief，也不依赖运行中的实例**（ADR 0007）：
 * 它引用到的来源内容连同采集那一刻的正文快照一起固定在档案里。
 *
 * 来源授权凭据（OAuth token、API key、Cookie）是本地 secret，不属于领域数据，
 * 也不进这份档案（ADR 0008）。这里只读，不写任何一张表。
 */
export type ExportedSourceContent = {
  id: string;
  endpointId: string;
  endpointName: string;
  endpointUrl: string;
  externalId: string;
  title: string;
  /** 采集那一刻的正文快照（ADR 0015）。 */
  body: string;
  originUrl: string;
  publishedAt: string | null;
  acquiredAt: string;
};

export type BriefArchive = {
  exportedAt: string;
  radarVersion: string;
  brief: { id: string; name: string; createdAt: string };
  revisions: BriefRevision[];
  sourceContents: ExportedSourceContent[];
  judgments: Judgment[];
  feedback: Feedback[];
  deliveries: Delivery[];
};

export type BriefExport = { archive: BriefArchive; readable: string };

export function exportBrief(briefId: string, radarVersion: string, now = new Date()): BriefExport {
  const brief = getBrief(briefId);
  if (!brief) throw new UnknownBriefError(briefId);

  const archive: BriefArchive = {
    exportedAt: now.toISOString(),
    radarVersion,
    brief: { id: brief.id, name: brief.name, createdAt: brief.createdAt },
    revisions: listBriefRevisions(briefId),
    sourceContents: sourceContentsForBrief(briefId),
    judgments: listJudgments(briefId),
    feedback: listFeedback(briefId),
    deliveries: listDeliveries(briefId),
  };
  return { archive, readable: renderReadable(archive) };
}

/**
 * 这个 Brief 引用到的来源内容：进过它的队列的，判断落在它身上的，以及被那些
 * 判断引为证据的。别的 Brief 的内容不进来——档案脱离它们照样读得完整。
 */
function sourceContentsForBrief(briefId: string): ExportedSourceContent[] {
  const rows = database()
    .prepare(
      `SELECT content.id, content.endpoint_id, content.external_id, content.title, content.body,
              content.origin_url, content.published_at, content.acquired_at,
              endpoint.name AS endpoint_name, endpoint.url AS endpoint_url
       FROM source_contents AS content
       JOIN endpoints AS endpoint ON endpoint.id = content.endpoint_id
       WHERE content.id IN (SELECT source_content_id FROM queue_entries WHERE brief_id = ?)
          OR content.id IN (SELECT source_content_id FROM judgments WHERE brief_id = ?)
          OR content.id IN (
               SELECT signal.source_content_id FROM judgment_signals AS signal
               JOIN judgments AS judgment ON judgment.id = signal.judgment_id
               WHERE judgment.brief_id = ?
             )
       ORDER BY content.acquired_at, content.id`,
    )
    .all(briefId, briefId, briefId) as Array<{
    id: string;
    endpoint_id: string;
    endpoint_name: string;
    endpoint_url: string;
    external_id: string;
    title: string;
    body: string;
    origin_url: string;
    published_at: string | null;
    acquired_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    endpointId: row.endpoint_id,
    endpointName: row.endpoint_name,
    endpointUrl: row.endpoint_url,
    externalId: row.external_id,
    title: row.title,
    body: row.body,
    originUrl: row.origin_url,
    publishedAt: row.published_at,
    acquiredAt: row.acquired_at,
  }));
}

/**
 * 可直接阅读的那一份。Markdown 是纯文本，任何编辑器都打得开——不需要 Radar
 * 还活着，也不需要懂 SQLite。
 */
function renderReadable(archive: BriefArchive): string {
  const contents = new Map(archive.sourceContents.map((content) => [content.id, content]));
  const deliveriesByJudgment = new Map<string, Delivery[]>();
  for (const delivery of archive.deliveries) {
    deliveriesByJudgment.set(delivery.judgmentId, [
      ...(deliveriesByJudgment.get(delivery.judgmentId) ?? []),
      delivery,
    ]);
  }
  const feedbackByJudgment = new Map<string, Feedback[]>();
  for (const item of archive.feedback) {
    if (!item.judgmentId) continue;
    feedbackByJudgment.set(item.judgmentId, [
      ...(feedbackByJudgment.get(item.judgmentId) ?? []),
      item,
    ]);
  }

  const relevant = archive.judgments.filter((judgment) => judgment.relevant);
  const eliminated = archive.judgments.filter((judgment) => !judgment.relevant);
  const lines: string[] = [
    `# ${archive.brief.name}`,
    "",
    `Radar ${archive.radarVersion} 于 ${archive.exportedAt} 导出。Brief ${archive.brief.id}，` +
      `建于 ${archive.brief.createdAt}。`,
    "",
    "这份档案脱离 Radar 也读得完：判断连着它依据的来源内容，来源内容带着采集那一刻的正文快照。",
    "",
    "## 这个 Brief 现在说什么",
    "",
    archive.revisions[0]?.body ?? "（没有正文）",
    "",
    `## 判断：相关 ${relevant.length} 条`,
    "",
  ];

  for (const judgment of relevant) {
    const content = contents.get(judgment.sourceContentId);
    lines.push(
      `### ${content?.title ?? judgment.sourceContentId}`,
      "",
      `${judgment.createdAt}，由 ${judgment.judgedBy} 判断。`,
      "",
      `- **是什么**：${judgment.whatItIs}`,
      `- **依据**：${judgment.evidence}`,
      `- **还不确定**：${judgment.uncertainty}`,
      `- **为什么给你**：${judgment.whyForYou}`,
    );
    if (content) {
      lines.push(`- **来源**：${content.endpointName} · ${content.originUrl}`);
    }
    for (const signal of judgment.signals) {
      lines.push(`- **另一条证据**：${signal.title} · ${signal.originUrl}`);
    }
    for (const delivery of deliveriesByJudgment.get(judgment.id) ?? []) {
      const reference = delivery.externalReference ? `，引用 ${delivery.externalReference}` : "";
      lines.push(`- **已交付**：${delivery.destination}，${delivery.deliveredAt}${reference}`);
    }
    for (const item of feedbackByJudgment.get(judgment.id) ?? []) {
      lines.push(`- **你说过**：${item.disposition}——${item.note}`);
    }
    lines.push("");
  }

  lines.push(`## 判断：淘汰 ${eliminated.length} 条`, "");
  for (const judgment of eliminated) {
    const content = contents.get(judgment.sourceContentId);
    lines.push(`- ${content?.title ?? judgment.sourceContentId}——${judgment.whyForYou}`);
  }
  lines.push("");

  const briefLevelFeedback = archive.feedback.filter((item) => !item.judgmentId);
  lines.push(`## 反馈：${archive.feedback.length} 条`, "");
  for (const item of briefLevelFeedback) {
    lines.push(`- ${item.createdAt}｜${item.disposition}——${item.note}`);
  }
  if (briefLevelFeedback.length === 0) lines.push("（都挂在具体判断上，见上面每条判断。）");
  lines.push("");

  lines.push(`## Brief 修订：${archive.revisions.length} 版`, "");
  for (const revision of archive.revisions) {
    lines.push(
      `### 第 ${revision.number} 版（${revision.createdAt}）`,
      "",
      revision.rationale ? `改动依据：${revision.rationale}` : "初版。",
      "",
      revision.body,
      "",
    );
  }

  lines.push(`## 来源内容快照：${archive.sourceContents.length} 条`, "");
  for (const content of archive.sourceContents) {
    lines.push(
      `### ${content.title}`,
      "",
      `${content.endpointName}｜发布于 ${content.publishedAt ?? "未知"}｜` +
        `采于 ${content.acquiredAt}｜${content.originUrl}`,
      "",
      content.body,
      "",
    );
  }

  return lines.join("\n");
}
