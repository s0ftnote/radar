import { randomUUID } from "node:crypto";
import { database } from "./database.js";

export type Feedback = {
  id: string;
  briefId: string;
  /** 挂在一个具体判断上，或者只挂在 Brief 上（「以后招聘帖一律不要」）。 */
  judgmentId: string | null;
  /** 处置标签由 Agent 归纳，Radar 不预设可选值也不解释。 */
  disposition: string;
  note: string;
  createdAt: string;
};

type FeedbackRow = {
  id: string;
  brief_id: string;
  judgment_id: string | null;
  disposition: string;
  note: string;
  created_at: string;
};

/** 只有用户明说的才是反馈；Agent 自己取用时的取舍不构成反馈。 */
export function recordFeedback(input: {
  briefId: string;
  judgmentId?: string | null;
  disposition: string;
  note: string;
}): Feedback {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  database().prepare(
    `INSERT INTO feedback (id, brief_id, judgment_id, disposition, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, input.briefId, input.judgmentId ?? null, input.disposition, input.note, createdAt);
  return {
    id,
    briefId: input.briefId,
    judgmentId: input.judgmentId ?? null,
    disposition: input.disposition,
    note: input.note,
    createdAt,
  };
}

/** 工作包带回这个 Brief 的**全部**反馈，原样——那是后续判断的上下文。 */
export function listFeedback(briefId: string): Feedback[] {
  return (
    database()
      .prepare("SELECT * FROM feedback WHERE brief_id = ? ORDER BY created_at, id")
      .all(briefId) as FeedbackRow[]
  ).map((row) => ({
    id: row.id,
    briefId: row.brief_id,
    judgmentId: row.judgment_id,
    disposition: row.disposition,
    note: row.note,
    createdAt: row.created_at,
  }));
}
