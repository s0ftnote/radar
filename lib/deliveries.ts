import { database } from "./database.js";
import { RadarDomainError } from "./domain-error.js";
import { UnknownJudgmentError, getJudgment, listJudgmentsByIds, type Judgment } from "./judgments.js";
import { UnknownWatchedSubjectError, listWatchedSubjects } from "./watched-subjects.js";

/**
 * 交付去处是 Agent 自报的标签（`周报`、`obsidian`）。Radar 不预设可选值、
 * 不校验、不解释——它只记账：什么已经交付到哪里过。
 *
 * 跨系统没法原子提交，所以这里是**至少一次交付**：judgment id 稳定，外部引用
 * 幂等，重复标记同一对（判断，去处）不会记成两笔。账实不符时用户可以
 * `radar deliver unmark` 自己把账改回来。
 */
export type Delivery = {
  judgmentId: string;
  destination: string;
  /** Agent 自报的外部引用。Radar 不解释它，只保证它还在。 */
  externalReference: string | null;
  deliveredAt: string;
};

export class UnknownDeliveryError extends RadarDomainError {
  constructor(judgmentId: string, destination: string) {
    super(`判断 ${judgmentId} 没有交付到「${destination}」的记录。`, 404);
  }
}

export type TakeOptions = {
  briefId: string;
  destination: string;
  /** 时间窗，按判断写回的时间算。 */
  since?: string;
  until?: string;
  /** 顺着这条判断的关联链取材：链上已经送过的也一并给出。 */
  relatedTo?: string;
  /** 按关注对象取材：名字或别名机械匹配判断正文。 */
  subject?: string;
  limit: number;
};

/**
 * 默认取还没送到这个去处的判断，也就是增量。时间窗只是在增量上再收窄。
 *
 * `relatedTo` 不一样：顺着关联链取材本来就是为了「同一件事三周后又冒出来，
 * 找回上次那条笔记去改」，上次那条恰恰是已经送过的。所以链上不排除已送的，
 * 否则要找的那条永远看不见。配 `radar deliver history` 就能拿到它的外部引用。
 */
export function takeForDelivery(options: TakeOptions): Judgment[] {
  // 条件和参数一条一条一起加，顺序自然对上，不靠谁记得哪个 `?` 排在前面。
  // 淘汰的判断不是输出材料——它的正文只有一条淘汰理由。
  const filters = ["judgment.brief_id = ?", "judgment.relevant = 1"];
  const parameters: unknown[] = [options.briefId];

  if (options.relatedTo) {
    filters.push(`judgment.id IN (${relationChainSql})`);
    parameters.push(options.relatedTo);
  } else {
    filters.push(
      `NOT EXISTS (SELECT 1 FROM deliveries AS delivery
         WHERE delivery.judgment_id = judgment.id AND delivery.destination = ?)`,
    );
    parameters.push(options.destination);
  }
  if (options.since) {
    filters.push("judgment.created_at >= ?");
    parameters.push(options.since);
  }
  if (options.until) {
    filters.push("judgment.created_at <= ?");
    parameters.push(options.until);
  }
  if (options.subject) {
    const terms = subjectTerms(options.briefId, options.subject);
    filters.push(`(${terms.map(() => `INSTR(${judgmentProse}, LOWER(?)) > 0`).join(" OR ")})`);
    parameters.push(...terms);
  }
  parameters.push(options.limit);

  const rows = database()
    .prepare(
      `SELECT judgment.id FROM judgments AS judgment
       WHERE ${filters.join(" AND ")}
       ORDER BY judgment.created_at DESC, judgment.id DESC
       LIMIT ?`,
    )
    .all(...(parameters as never[])) as Array<{ id: string }>;

  return listJudgmentsByIds(rows.map((row) => row.id));
}

/**
 * 关联链：从这条判断出发，顺着 `judgment_relations` 双向走到底，出发那条也算
 * 在链上——「这件事上次是怎么写的」问的就是它。关联是 Agent 自报的，
 * Radar 只跟着走，不判断它对不对。
 */
const relationChainSql = `
  WITH RECURSIVE chain(id) AS (
    SELECT ?
    UNION
    SELECT relation.related_judgment_id FROM judgment_relations AS relation
    JOIN chain ON chain.id = relation.judgment_id
    UNION
    SELECT relation.judgment_id FROM judgment_relations AS relation
    JOIN chain ON chain.id = relation.related_judgment_id
  )
  SELECT id FROM chain
`;

/**
 * 交付由 Agent 显式标记——读到不算送到。同一判断送去多个去处，各记各的。
 * `delivered_at` 停在第一次送到的时刻：重复标记是补记同一笔账，不是又送了一次。
 */
export function markDelivered(input: {
  briefId: string;
  judgmentId: string;
  destination: string;
  externalReference?: string;
}): Delivery {
  requireJudgmentInBrief(input.briefId, input.judgmentId);
  const row = database()
    .prepare(
      `INSERT INTO deliveries (judgment_id, destination, external_reference, delivered_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(judgment_id, destination) DO UPDATE SET
         external_reference = COALESCE(excluded.external_reference, deliveries.external_reference)
       RETURNING *`,
    )
    .get(
      input.judgmentId,
      input.destination,
      input.externalReference ?? null,
      new Date().toISOString(),
    ) as DeliveryRow;
  return mapDelivery(row);
}

/** 账实不符时用户自己把账改回来：删掉这一笔，下次取材它又回到增量里。 */
export function unmarkDelivered(briefId: string, judgmentId: string, destination: string): void {
  requireJudgmentInBrief(briefId, judgmentId);
  const removed = database()
    .prepare("DELETE FROM deliveries WHERE judgment_id = ? AND destination = ?")
    .run(judgmentId, destination);
  if (removed.changes === 0) throw new UnknownDeliveryError(judgmentId, destination);
}

export function listDeliveries(briefId: string, destination?: string): Delivery[] {
  const rows = database()
    .prepare(
      `SELECT delivery.* FROM deliveries AS delivery
       JOIN judgments AS judgment ON judgment.id = delivery.judgment_id
       WHERE judgment.brief_id = ? AND (? IS NULL OR delivery.destination = ?)
       ORDER BY delivery.delivered_at DESC, delivery.judgment_id DESC`,
    )
    .all(briefId, destination ?? null, destination ?? null) as DeliveryRow[];
  return rows.map(mapDelivery);
}

/**
 * 交付记录归属单个 Brief（ADR 0007）。判断 id 从别的 Brief 借过来的，
 * 在这条 Brief 眼里就是不存在。
 */
function requireJudgmentInBrief(briefId: string, judgmentId: string): void {
  const judgment = getJudgment(judgmentId);
  if (!judgment || judgment.briefId !== briefId) throw new UnknownJudgmentError(judgmentId);
}

type DeliveryRow = {
  judgment_id: string;
  destination: string;
  external_reference: string | null;
  delivered_at: string;
};

/** 判断正文拼一块拿去机械匹配关注对象。淘汰理由不在里面——淘汰的判断本就取不到。 */
const judgmentProse =
  "LOWER(judgment.what_it_is || ' ' || judgment.evidence || ' ' || judgment.why_for_you)";

/** 关注对象的名字与别名。别名只供机械匹配，Radar 不核对身份。 */
function subjectTerms(briefId: string, name: string): string[] {
  const subject = listWatchedSubjects(briefId).find((candidate) => candidate.name === name);
  if (!subject) throw new UnknownWatchedSubjectError(briefId, name);
  return [subject.name, ...subject.aliases];
}

function mapDelivery(row: DeliveryRow): Delivery {
  return {
    judgmentId: row.judgment_id,
    destination: row.destination,
    externalReference: row.external_reference,
    deliveredAt: row.delivered_at,
  };
}
