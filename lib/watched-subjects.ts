import { randomUUID } from "node:crypto";
import { database, inTransaction } from "./database.js";
import { RadarDomainError } from "./domain-error.js";

/**
 * 关注对象是 Brief 内部的一行书签，作用域必然是 Brief 级。Radar 不核对身份、
 * 不区分人与组织、不判断跟踪范围——「什么算这个对象的实质出场」是 Brief 正文
 * 里的判断标准。别名只供机械匹配。
 */
export type WatchedSubject = {
  id: string;
  briefId: string;
  name: string;
  aliases: string[];
  endpointIds: string[];
  createdAt: string;
};

export type WatchedSubjectInput = {
  briefId: string;
  name: string;
  /** 改名字。给了就沿用原来那条的 id 与创建时间，票 6 要按 id 排序权重。 */
  renameTo?: string;
  aliases?: string[];
  endpointIds?: string[];
};

export class UnknownWatchedSubjectError extends RadarDomainError {
  constructor(briefId: string, name: string) {
    super(`Brief ${briefId} 里没有叫「${name}」的关注对象。`, 404);
  }
}

export function listWatchedSubjects(briefId: string): WatchedSubject[] {
  const rows = database()
    .prepare(
      "SELECT id, brief_id, name, created_at FROM watched_subjects WHERE brief_id = ? ORDER BY name",
    )
    .all(briefId) as Array<{ id: string; brief_id: string; name: string; created_at: string }>;
  return rows.map((row) => getWatchedSubject(row.id));
}

/**
 * 新增或改写一个关注对象。同一个 Brief 里同名即同一条，别名与端点整体替换。
 * `renameTo` 改名字而不换 id——那条书签还是同一条。
 */
export function putWatchedSubject(input: WatchedSubjectInput): WatchedSubject {
  const db = database();
  const subjectId = inTransaction(() => {
    const existing = db
      .prepare("SELECT id FROM watched_subjects WHERE brief_id = ? AND name = ?")
      .get(input.briefId, input.name) as { id: string } | undefined;

    if (input.renameTo && !existing) throw new UnknownWatchedSubjectError(input.briefId, input.name);

    const id = existing?.id ?? randomUUID();
    if (!existing) {
      db.prepare(
        "INSERT INTO watched_subjects (id, brief_id, name, created_at) VALUES (?, ?, ?, ?)",
      ).run(id, input.briefId, input.name, new Date().toISOString());
    } else if (input.renameTo) {
      db.prepare("UPDATE watched_subjects SET name = ? WHERE id = ?").run(input.renameTo, id);
    }

    db.prepare("DELETE FROM watched_subject_aliases WHERE subject_id = ?").run(id);
    for (const alias of new Set(input.aliases ?? [])) {
      db.prepare("INSERT INTO watched_subject_aliases (subject_id, alias) VALUES (?, ?)").run(
        id,
        alias,
      );
    }

    db.prepare("DELETE FROM watched_subject_endpoints WHERE subject_id = ?").run(id);
    for (const endpointId of new Set(input.endpointIds ?? [])) {
      db.prepare(
        "INSERT INTO watched_subject_endpoints (subject_id, endpoint_id) VALUES (?, ?)",
      ).run(id, endpointId);
    }
    return id;
  });

  return getWatchedSubject(subjectId);
}

/** 删一个关注对象。只有用户明说才会走到这里。 */
export function removeWatchedSubject(briefId: string, name: string): void {
  const removed = database()
    .prepare("DELETE FROM watched_subjects WHERE brief_id = ? AND name = ?")
    .run(briefId, name);
  if (removed.changes === 0) throw new UnknownWatchedSubjectError(briefId, name);
}

function getWatchedSubject(subjectId: string): WatchedSubject {
  const row = database()
    .prepare("SELECT id, brief_id, name, created_at FROM watched_subjects WHERE id = ?")
    .get(subjectId) as { id: string; brief_id: string; name: string; created_at: string };
  return {
    id: row.id,
    briefId: row.brief_id,
    name: row.name,
    aliases: aliasesOf(row.id),
    endpointIds: endpointIdsOf(row.id),
    createdAt: row.created_at,
  };
}

function aliasesOf(subjectId: string): string[] {
  return (
    database()
      .prepare("SELECT alias FROM watched_subject_aliases WHERE subject_id = ? ORDER BY alias")
      .all(subjectId) as Array<{ alias: string }>
  ).map((row) => row.alias);
}

function endpointIdsOf(subjectId: string): string[] {
  return (
    database()
      .prepare(
        "SELECT endpoint_id FROM watched_subject_endpoints WHERE subject_id = ? ORDER BY endpoint_id",
      )
      .all(subjectId) as Array<{ endpoint_id: string }>
  ).map((row) => row.endpoint_id);
}
