import { database } from "./database.js";
import { RadarDomainError } from "./domain-error.js";
import { listJudgmentsByIds, type Judgment } from "./judgments.js";

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
  /** 顺着这条判断的关联链取材，而不是只取增量。 */
  relatedTo?: string;
  limit: number;
};

/**
 * 取还没送到这个去处的判断。默认是增量；也可以按时间窗、按判断之间的关联链
 * 取材——后两者都不受「没送过」限制之外的额外筛选。
 */
export function takeForDelivery(options: TakeOptions): Judgment[] {
  const filters = ["judgment.brief_id = ?", "delivery.judgment_id IS NULL"];
  const parameters: unknown[] = [options.destination, options.briefId];

  if (options.since) {
    filters.push("judgment.created_at >= ?");
    parameters.push(options.since);
  }
  if (options.until) {
    filters.push("judgment.created_at <= ?");
    parameters.push(options.until);
  }
  if (options.relatedTo) {
    filters.push(`judgment.id IN (${relationChainSql})`);
    parameters.push(options.relatedTo, options.relatedTo);
  }

  const rows = database()
    .prepare(
      `SELECT judgment.id FROM judgments AS judgment
       LEFT JOIN deliveries AS delivery
         ON delivery.judgment_id = judgment.id AND delivery.destination = ?
       WHERE ${filters.join(" AND ")}
       ORDER BY judgment.created_at DESC, judgment.id DESC
       LIMIT ?`,
    )
    .all(...(parameters as never[]), options.limit) as Array<{ id: string }>;

  return listJudgmentsByIds(rows.map((row) => row.id));
}

/**
 * 关联链：从一条判断出发，顺着 `judgment_relations` 双向走到底。关联是
 * Agent 自报的，Radar 只跟着走，不判断它对不对。
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
  SELECT id FROM chain WHERE id <> ?
`;

/** 交付由 Agent 显式标记——读到不算送到。同一判断送去多个去处，各记各的。 */
export function markDelivered(input: {
  judgmentId: string;
  destination: string;
  externalReference?: string;
}): Delivery {
  const db = database();
  db.prepare(
    `INSERT INTO deliveries (judgment_id, destination, external_reference, delivered_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(judgment_id, destination) DO UPDATE SET
       external_reference = COALESCE(excluded.external_reference, deliveries.external_reference)`,
  ).run(
    input.judgmentId,
    input.destination,
    input.externalReference ?? null,
    new Date().toISOString(),
  );
  return getDelivery(input.judgmentId, input.destination)!;
}

/** 账实不符时用户自己把账改回来：删掉这一笔，下次取材它又回到增量里。 */
export function unmarkDelivered(judgmentId: string, destination: string): void {
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
       WHERE judgment.brief_id = ?${destination ? " AND delivery.destination = ?" : ""}
       ORDER BY delivery.delivered_at DESC, delivery.judgment_id DESC`,
    )
    .all(...(destination ? [briefId, destination] : [briefId])) as DeliveryRow[];
  return rows.map(mapDelivery);
}

function getDelivery(judgmentId: string, destination: string): Delivery | null {
  const row = database()
    .prepare("SELECT * FROM deliveries WHERE judgment_id = ? AND destination = ?")
    .get(judgmentId, destination) as DeliveryRow | undefined;
  return row ? mapDelivery(row) : null;
}

type DeliveryRow = {
  judgment_id: string;
  destination: string;
  external_reference: string | null;
  delivered_at: string;
};

function mapDelivery(row: DeliveryRow): Delivery {
  return {
    judgmentId: row.judgment_id,
    destination: row.destination,
    externalReference: row.external_reference,
    deliveredAt: row.delivered_at,
  };
}
