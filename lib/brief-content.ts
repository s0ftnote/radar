import { database } from "./database.js";
import { includedInBriefSql } from "./endpoints.js";
import { groupBy } from "./group-by.js";

/**
 * 内容页要读的那份视图：一个 Brief 里所有内容，带上它现在处在哪一档。
 *
 * 三档不是三种「处理结果」，是**同一条内容走到哪儿了**——Radar 只排序不丢弃
 * （ADR 0010），所以没有「被丢掉」这一档。`filtered` 是 AI 判过说不给你看，
 * 理由照样写在那儿；`pending` 是还没轮到，它随时可能变成前两档。
 */
export type ContentState = "for_you" | "filtered" | "pending";

export type ContentItem = {
  state: ContentState;
  sourceContentId: string;
  title: string;
  author: string | null;
  body: string;
  originUrl: string;
  endpointId: string;
  endpointName: string;
  channelName: string;
  tags: string[];
  publishedAt: string | null;
  /** 排序与显示用的那个时间：判过的用判断时间，没判的用入队时间。 */
  at: string;
  judgment: {
    id: string;
    whatItIs: string;
    evidence: string;
    uncertainty: string;
    whyForYou: string;
    judgedBy: string;
  } | null;
  /** 用户已经在这条上说过的话。说过就摆出来，不然同一条会被反复点。 */
  feedback: Array<{ disposition: string; note: string; createdAt: string }>;
};

export type ContentFilters = {
  briefId: string;
  /** 空数组当作「全都要」——链接上不带筛选时就是这个意思。 */
  states?: ContentState[];
  endpointId?: string;
};

export type ContentFacets = {
  counts: Record<ContentState, number>;
  endpoints: Array<{ id: string; name: string; count: number }>;
};

type JudgedRow = {
  source_content_id: string;
  title: string;
  author: string | null;
  body: string;
  origin_url: string;
  endpoint_id: string;
  endpoint_name: string;
  channel_name: string;
  published_at: string | null;
  relevant: number;
  judgment_id: string;
  what_it_is: string;
  evidence: string;
  uncertainty: string;
  judgment_tags: string;
  why_for_you: string;
  judged_by: string;
  created_at: string;
};

type PendingRow = {
  source_content_id: string;
  title: string;
  author: string | null;
  body: string;
  origin_url: string;
  endpoint_id: string;
  endpoint_name: string;
  channel_name: string;
  published_at: string | null;
  queued_at: string;
};

/**
 * 判过的：每条内容取**最近一次**判断。回捞重判会留下同一条内容的多次判断，
 * 页面只说它现在算什么，历史归 `radar judgments`。
 */
const judgedSelection = `
  SELECT content.id AS source_content_id, content.title, content.author, content.body,
         content.origin_url, content.endpoint_id, endpoint.name AS endpoint_name,
         channel.name AS channel_name, content.published_at,
         judgment.relevant, judgment.id AS judgment_id, judgment.what_it_is,
         judgment.evidence, judgment.uncertainty, judgment.tags AS judgment_tags,
         judgment.why_for_you,
         judgment.judged_by, judgment.created_at
    FROM judgments AS judgment
    JOIN source_contents AS content ON content.id = judgment.source_content_id
    JOIN endpoints AS endpoint ON endpoint.id = content.endpoint_id
    JOIN channels AS channel ON channel.id = endpoint.channel_id
`;

const latestJudgedSelection = `${judgedSelection}
   WHERE judgment.brief_id = :briefId
     AND judgment.id = (
       SELECT latest.id FROM judgments AS latest
        WHERE latest.brief_id = judgment.brief_id
          AND latest.source_content_id = judgment.source_content_id
        ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1
     )
`;

/**
 * 还没判的：队列里开着的代次，只留这个 Brief 纳入的端点——纳入是读侧的事，
 * 页面是读侧，所以这里生效（ADR 0018）。判过的内容代次已经关了，不会重复出现。
 */
const pendingSelection = `
  SELECT content.id AS source_content_id, content.title, content.author, content.body,
         content.origin_url, content.endpoint_id, endpoint.name AS endpoint_name,
         channel.name AS channel_name, content.published_at,
         entry.queued_at
    FROM queue_entries AS entry
    JOIN source_contents AS content ON content.id = entry.source_content_id
    JOIN endpoints AS endpoint ON endpoint.id = content.endpoint_id
    JOIN channels AS channel ON channel.id = endpoint.channel_id
   WHERE entry.brief_id = :briefId AND entry.closed_at IS NULL
     AND content.endpoint_id IN (${includedInBriefSql(":briefId")})
`;

export function listBriefContent(filters: ContentFilters, limit = 200): ContentItem[] {
  const page = collect(filters).slice(0, limit);
  attachFeedback(filters.briefId, page);
  return page;
}

export function getBriefContent(briefId: string, sourceContentId: string): ContentItem | null {
  const item = collect({ briefId }).find((each) => each.sourceContentId === sourceContentId) ?? null;
  if (item) attachFeedback(briefId, [item]);
  return item;
}

/** 报告回看用：精确读取报告当时引用的那一次判断，不跟随之后的重判。 */
export function getBriefContentAtJudgment(
  briefId: string,
  sourceContentId: string,
  judgmentId: string,
): ContentItem | null {
  const row = database()
    .prepare(
      `${judgedSelection}
       WHERE judgment.brief_id = :briefId
         AND content.id = :sourceContentId
         AND judgment.id = :judgmentId`,
    )
    .get({ briefId, sourceContentId, judgmentId }) as JudgedRow | undefined;
  if (!row) return null;
  const item = mapJudgedRow(row);
  attachFeedback(briefId, [item]);
  return item;
}

/** 取回并排好序，不带反馈——数数的那条路不需要反馈，别为它多查一遍。 */
function collect(filters: ContentFilters): ContentItem[] {
  const wanted = new Set<ContentState>(
    filters.states?.length ? filters.states : ["for_you", "filtered", "pending"],
  );
  const db = database();
  const items: ContentItem[] = [];

  if (wanted.has("for_you") || wanted.has("filtered")) {
    for (const row of db
      .prepare(latestJudgedSelection)
      .all({ briefId: filters.briefId }) as JudgedRow[]) {
      const state: ContentState = row.relevant === 1 ? "for_you" : "filtered";
      if (!wanted.has(state)) continue;
      items.push(mapJudgedRow(row));
    }
  }

  if (wanted.has("pending")) {
    for (const row of db
      .prepare(pendingSelection)
      .all({ briefId: filters.briefId }) as PendingRow[]) {
      items.push({
        state: "pending",
        sourceContentId: row.source_content_id,
        title: row.title,
        author: row.author,
        body: row.body,
        originUrl: row.origin_url,
        endpointId: row.endpoint_id,
        endpointName: row.endpoint_name,
        channelName: row.channel_name,
        tags: [],
        publishedAt: row.published_at,
        at: row.queued_at,
        judgment: null,
        feedback: [],
      });
    }
  }

  const filtered = filters.endpointId
    ? items.filter((item) => item.endpointId === filters.endpointId)
    : items;

  // 新的在前。同一时刻按内容 id，保证两次刷新看到同一个顺序。
  filtered.sort(
    (left, right) =>
      right.at.localeCompare(left.at) ||
      left.sourceContentId.localeCompare(right.sourceContentId),
  );
  return filtered;
}

function documentTags(raw: string): string[] {
  const parsed = JSON.parse(raw) as unknown;
  return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
}

function mapJudgedRow(row: JudgedRow): ContentItem {
  return {
    state: row.relevant === 1 ? "for_you" : "filtered",
    sourceContentId: row.source_content_id,
    title: row.title,
    author: row.author,
    body: row.body,
    originUrl: row.origin_url,
    endpointId: row.endpoint_id,
    endpointName: row.endpoint_name,
    channelName: row.channel_name,
    tags: documentTags(row.judgment_tags),
    publishedAt: row.published_at,
    at: row.created_at,
    judgment: {
      id: row.judgment_id,
      whatItIs: row.what_it_is,
      evidence: row.evidence,
      uncertainty: row.uncertainty,
      whyForYou: row.why_for_you,
      judgedBy: row.judged_by,
    },
    feedback: [],
  };
}

/** 反馈一次取回，不按条数发查询。 */
function attachFeedback(briefId: string, items: ContentItem[]): void {
  const judgmentIds = items.flatMap((item) => (item.judgment ? [item.judgment.id] : []));
  if (judgmentIds.length === 0) return;
  const placeholders = judgmentIds.map(() => "?").join(", ");
  const rows = database()
    .prepare(
      `SELECT judgment_id, disposition, note, created_at FROM feedback
        WHERE brief_id = ? AND judgment_id IN (${placeholders})
        ORDER BY created_at, id`,
    )
    .all(briefId, ...judgmentIds) as Array<{
    judgment_id: string;
    disposition: string;
    note: string;
    created_at: string;
  }>;
  const byJudgment = groupBy(rows, (row) => row.judgment_id);
  for (const item of items) {
    if (!item.judgment) continue;
    item.feedback = (byJudgment.get(item.judgment.id) ?? []).map((row) => ({
      disposition: row.disposition,
      note: row.note,
      createdAt: row.created_at,
    }));
  }
}

/** 筛选器上要显示的数目：每一档多少条、各来源多少条。数的是全量，不受当前筛选影响。 */
export function contentFacets(briefId: string): ContentFacets {
  const all = collect({ briefId });
  const counts: Record<ContentState, number> = { for_you: 0, filtered: 0, pending: 0 };
  const endpoints = new Map<string, { id: string; name: string; count: number }>();
  for (const item of all) {
    counts[item.state] += 1;
    const seen = endpoints.get(item.endpointId);
    if (seen) seen.count += 1;
    else endpoints.set(item.endpointId, { id: item.endpointId, name: item.endpointName, count: 1 });
  }
  return {
    counts,
    endpoints: [...endpoints.values()].sort((left, right) => left.name.localeCompare(right.name)),
  };
}
