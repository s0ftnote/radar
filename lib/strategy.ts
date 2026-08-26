import { randomUUID } from "node:crypto";
import { database } from "./database.js";
import { RadarDomainError } from "./domain-error.js";
import { asRecord } from "./as-record.js";
import {
  listEndpointHitStats,
  listSignalHitStats,
  type EndpointHitStats,
  type SignalHitStats,
} from "./hit-stats.js";

/**
 * 排队策略：Agent 读懂 Brief 之后写下的一份打分公式。
 *
 * 信号只取 Radar 自己就有的机械事实——新鲜度、端点权重、平台自带热度、
 * 关键词命中、该端点在本 Brief 的历史命中率。Radar 全程不理解内容：关键词
 * 只是子串匹配，权重只能加减分，**不能用于排除**（ADR 0010：只排序不丢弃）。
 *
 * 关注对象的别名与端点权重要生效，得由 Agent 自己写进 `keywords` 与
 * `endpointWeights`——Radar 不自动接。
 */
export type StrategyFormula = {
  /** 新鲜度半衰期，小时。越小越偏向新内容。 */
  freshnessHalfLifeHours: number;
  freshnessWeight: number;
  /** 端点权重，端点 id → 分数。没列到的算 0。 */
  endpointWeights: Record<string, number>;
  /** 关键词命中就加这么多分。可以是负数——那是减分，不是排除。 */
  keywords: Array<{ term: string; weight: number }>;
  /** 平台自带热度的系数。热度是平台给的原始数字，Radar 不做归一化。 */
  hotnessWeight: number;
  /** 该端点在本 Brief 的历史命中率的系数。 */
  hitRateWeight: number;
};

export type QueueStrategy = {
  id: string;
  briefId: string;
  revisionNumber: number;
  formula: StrategyFormula;
  rationale: string;
  authoredBy: string;
  createdAt: string;
};

/** 还没下发过公式那段时间，命中记账挂在这个哨兵上——那段的依据同样要留着。 */
export const defaultStrategyId = "default";

/** 没下发过策略时的默认公式：纯新鲜度。 */
export const defaultFormula: StrategyFormula = {
  freshnessHalfLifeHours: 24,
  freshnessWeight: 1,
  endpointWeights: {},
  keywords: [],
  hotnessWeight: 0,
  hitRateWeight: 0,
};

export class InvalidStrategyError extends RadarDomainError {
  constructor(message: string) {
    super(message, 400);
  }
}

type StrategyRow = {
  id: string;
  brief_id: string;
  revision_number: number;
  formula: string;
  rationale: string;
  authored_by: string;
  created_at: string;
};

/** 下发一份新策略。策略修订可追溯：旧版本一并留着，永不改写。 */
export function putStrategy(input: {
  briefId: string;
  formula: unknown;
  rationale: string;
  authoredBy: string;
}): QueueStrategy {
  const formula = parseFormula(input.formula);
  const db = database();
  const next =
    ((
      db
        .prepare("SELECT MAX(revision_number) AS latest FROM queue_strategies WHERE brief_id = ?")
        .get(input.briefId) as { latest: number | null }
    ).latest ?? 0) + 1;

  const id = randomUUID();
  db.prepare(
    `INSERT INTO queue_strategies
       (id, brief_id, revision_number, formula, rationale, authored_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.briefId,
    next,
    JSON.stringify(formula),
    input.rationale,
    input.authoredBy,
    new Date().toISOString(),
  );
  return currentStrategy(input.briefId)!;
}

/** 这个 Brief 现在生效的那一版策略。从没下发过就是 null。 */
export function currentStrategy(briefId: string): QueueStrategy | null {
  const row = database()
    .prepare(
      `SELECT * FROM queue_strategies WHERE brief_id = ?
       ORDER BY revision_number DESC LIMIT 1`,
    )
    .get(briefId) as StrategyRow | undefined;
  return row ? mapStrategy(row) : null;
}

export function listStrategyRevisions(briefId: string): QueueStrategy[] {
  return (
    database()
      .prepare("SELECT * FROM queue_strategies WHERE brief_id = ? ORDER BY revision_number DESC")
      .all(briefId) as StrategyRow[]
  ).map(mapStrategy);
}

/**
 * 公式来自 Agent，照单全收之前先把形状校对一遍。校对的是形状不是内容——
 * Radar 不判断这份公式好不好。
 */
function parseFormula(value: unknown): StrategyFormula {
  const raw = (value ?? {}) as Record<string, unknown>;
  const halfLife = numberOr(raw.freshnessHalfLifeHours, defaultFormula.freshnessHalfLifeHours);
  if (!(halfLife > 0)) throw new InvalidStrategyError("freshnessHalfLifeHours 要大于 0。");

  const endpointWeights: Record<string, number> = {};
  for (const [endpointId, weight] of Object.entries(asRecord(raw.endpointWeights) ?? {})) {
    if (typeof weight !== "number" || !Number.isFinite(weight)) {
      throw new InvalidStrategyError(`端点 ${endpointId} 的权重要是一个有限的数。`);
    }
    endpointWeights[endpointId] = weight;
  }

  const keywords = (Array.isArray(raw.keywords) ? raw.keywords : []).map((entry) => {
    const keyword = (entry ?? {}) as Record<string, unknown>;
    const term = typeof keyword.term === "string" ? keyword.term.trim() : "";
    const weight = keyword.weight;
    if (!term) throw new InvalidStrategyError("关键词的 term 不能为空。");
    if (typeof weight !== "number" || !Number.isFinite(weight)) {
      throw new InvalidStrategyError(`关键词「${term}」的权重要是一个有限的数。`);
    }
    // 关键词只能加减分，不能用于排除——排除是管家角色的两级开关干的事。
    if (typeof keyword.exclude !== "undefined") {
      throw new InvalidStrategyError(
        "关键词只能加减分，不能用于排除。要不看某个来源，用 `radar sources exclude`。",
      );
    }
    return { term, weight };
  });

  return {
    freshnessHalfLifeHours: halfLife,
    freshnessWeight: numberOr(raw.freshnessWeight, defaultFormula.freshnessWeight),
    endpointWeights,
    keywords,
    hotnessWeight: numberOr(raw.hotnessWeight, defaultFormula.hotnessWeight),
    hitRateWeight: numberOr(raw.hitRateWeight, defaultFormula.hitRateWeight),
  };
}

function numberOr(value: unknown, fallback: number): number {
  if (typeof value === "undefined") return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new InvalidStrategyError("策略里的每个权重都要是一个有限的数。");
  }
  return value;
}

function mapStrategy(row: StrategyRow): QueueStrategy {
  return {
    id: row.id,
    briefId: row.brief_id,
    revisionNumber: row.revision_number,
    formula: JSON.parse(row.formula) as StrategyFormula,
    rationale: row.rationale,
    authoredBy: row.authored_by,
    createdAt: row.created_at,
  };
}

/** 策略与它的命中依据一起给出去——修订公式要看的就是这两样。 */
export function strategyStats(briefId: string): {
  strategy: QueueStrategy | null;
  signals: SignalHitStats[];
  endpoints: EndpointHitStats[];
} {
  return {
    strategy: currentStrategy(briefId),
    signals: listSignalHitStats(briefId),
    endpoints: listEndpointHitStats(briefId),
  };
}
