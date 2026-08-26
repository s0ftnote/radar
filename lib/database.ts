import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { radarDataDirectory } from "./data-directory.js";

/**
 * 只有 Radar 服务进程碰这个句柄——它是 SQLite 的唯一写者（ADR 0012），
 * CLI 一律走 HTTP。
 */
let openDatabase: DatabaseSync | undefined;

export function database(): DatabaseSync {
  if (openDatabase?.isOpen) return openDatabase;

  const dataDirectory = radarDataDirectory();
  mkdirSync(dataDirectory, { recursive: true });
  const db = new DatabaseSync(resolve(dataDirectory, "radar.sqlite"), { timeout: 5_000 });
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  initializeSchema(db);
  openDatabase = db;
  return db;
}

export function closeDatabase(): void {
  if (openDatabase?.isOpen) openDatabase.close();
  openDatabase = undefined;
}

/** 一组写在同一个事务里；抛出即整体回滚。 */
export function inTransaction<T>(run: () => T): T {
  const db = database();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = run();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function initializeSchema(db: DatabaseSync): void {
  db.exec(`
    -- 采集渠道：一类外部来源的适配器类型。采集节奏归渠道，不逐个端点配。
    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      config_state TEXT NOT NULL CHECK (config_state IN ('ready', 'unlocked_by_config', 'unreachable')),
      collection_interval_seconds INTEGER NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;

    -- 采集端点：采集、去重、来源状态与开关的实际单位。
    -- id 一旦发布就永不复用、永不改写；端点搬家只改 url（ADR 0014）。
    CREATE TABLE IF NOT EXISTS endpoints (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES channels(id),
      name TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      -- 升级对账唯一要用的区分：用户自己加的端点一律不碰。
      provenance TEXT NOT NULL CHECK (provenance IN ('factory', 'user')),
      -- 机器可读的许可依据。出厂端点必填：目录准入第一条就是「许可允许机器读取」。
      license_basis TEXT,
      -- 停用有两个互不覆盖的来源：人写下的决定（用户停用）与目录写下的决定（退役）。
      -- 共用一个字段会让升级对账把用户手动停掉的源重新打开。
      user_disabled_at TEXT,
      retired_at TEXT,
      retired_reason TEXT,
      -- 来源状态。Radar 自己观察到的失败只导致退避，永不自动下架（ADR 0010）。
      last_attempt_at TEXT,
      last_success_at TEXT,
      last_error TEXT,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      retry_after TEXT,
      -- 配置后解锁渠道下的端点由 Agent 推送，这里只记最后一次收到推送（ADR 0011）。
      last_push_at TEXT,
      -- 单端点防重入：上一次采集没结束时不重复发起。
      collecting_since TEXT,
      created_at TEXT NOT NULL,
      CHECK (provenance = 'user' OR license_basis IS NOT NULL)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS briefs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;

    -- Brief 修订：当前版本与历史版本同时保留，并记录变化依据。
    CREATE TABLE IF NOT EXISTS brief_revisions (
      id TEXT PRIMARY KEY,
      brief_id TEXT NOT NULL REFERENCES briefs(id),
      revision_number INTEGER NOT NULL,
      body TEXT NOT NULL,
      rationale TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (brief_id, revision_number)
    ) STRICT;

    -- Brief 级排除：这个 Brief 不看它，其他 Brief 照采。
    -- 关注对象：Brief 内部的一行书签。名字 + 用于机械匹配的别名 + 关联采集端点。
    -- Radar 不核对身份、不区分人与组织——「什么算这个对象的实质出场」写在 Brief 正文里。
    -- 只有用户明确的自然语言修正才能增删，Radar 与 Agent 都不能自动加入。
    CREATE TABLE IF NOT EXISTS watched_subjects (
      id TEXT PRIMARY KEY,
      brief_id TEXT NOT NULL REFERENCES briefs(id),
      name TEXT NOT NULL CHECK (name <> ''),
      created_at TEXT NOT NULL,
      UNIQUE (brief_id, name)
    ) STRICT;

    -- 别名只供机械匹配，不代表 Radar 认得这是同一个人。
    CREATE TABLE IF NOT EXISTS watched_subject_aliases (
      subject_id TEXT NOT NULL REFERENCES watched_subjects(id) ON DELETE CASCADE,
      alias TEXT NOT NULL CHECK (alias <> ''),
      PRIMARY KEY (subject_id, alias)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS watched_subject_endpoints (
      subject_id TEXT NOT NULL REFERENCES watched_subjects(id) ON DELETE CASCADE,
      endpoint_id TEXT NOT NULL REFERENCES endpoints(id),
      PRIMARY KEY (subject_id, endpoint_id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS brief_endpoint_exclusions (
      brief_id TEXT NOT NULL REFERENCES briefs(id),
      endpoint_id TEXT NOT NULL REFERENCES endpoints(id),
      excluded_at TEXT NOT NULL,
      reason TEXT,
      PRIMARY KEY (brief_id, endpoint_id)
    ) STRICT;

    -- 来源内容。身份用 feed 自带的 guid / external_id，不用标题正文的整体哈希——
    -- 否则同一条被编辑就变成新内容重复入队。存的是采集那一刻的正文快照（ADR 0015）。
    CREATE TABLE IF NOT EXISTS source_contents (
      id TEXT PRIMARY KEY,
      endpoint_id TEXT NOT NULL REFERENCES endpoints(id),
      external_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      origin_url TEXT NOT NULL,
      published_at TEXT,
      raw_json TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      UNIQUE (endpoint_id, external_id)
    ) STRICT;

    -- 待判断队列。每一次入队是一个不可变的队列代次；重判须显式回捞，那开新的一代。
    -- 一代离开队列有两种原因，必须分得开：判过了，还是过了保留窗口被移出。
    -- 后者不删内容、可被显式回捞（ADR 0010），前者不行。
    CREATE TABLE IF NOT EXISTS queue_entries (
      id TEXT PRIMARY KEY,
      brief_id TEXT NOT NULL REFERENCES briefs(id),
      source_content_id TEXT NOT NULL REFERENCES source_contents(id),
      queued_at TEXT NOT NULL,
      closed_at TEXT,
      closed_because TEXT CHECK (closed_because IN ('judged', 'retention_window')),
      CHECK ((closed_at IS NULL) = (closed_because IS NULL))
    ) STRICT;
    -- 同一份内容在同一个 Brief 里同时只能有一代等着判。
    CREATE UNIQUE INDEX IF NOT EXISTS queue_entries_open
      ON queue_entries(brief_id, source_content_id) WHERE closed_at IS NULL;
    CREATE INDEX IF NOT EXISTS queue_entries_by_brief ON queue_entries(brief_id, queued_at);

    -- 判断以这一次判定为身份：Radar 只追加，不合并、不修订、不跨判断汇总。
    -- 排队策略是独立对象、独立版本化，不塞进 Brief——Brief 只有用户明确修正
    -- 才能改变，而策略是 Agent 自己改的。改的是顺序，不是判断标准。
    CREATE TABLE IF NOT EXISTS queue_strategies (
      id TEXT PRIMARY KEY,
      brief_id TEXT NOT NULL REFERENCES briefs(id),
      revision_number INTEGER NOT NULL,
      formula TEXT NOT NULL,
      rationale TEXT NOT NULL CHECK (rationale <> ''),
      authored_by TEXT NOT NULL CHECK (authored_by <> ''),
      created_at TEXT NOT NULL,
      UNIQUE (brief_id, revision_number)
    ) STRICT;

    -- 平台自带的热度。只有平台自己给了才有——RSS 没有，推送渠道可能有。
    -- Radar 不理解它，只把它当一个数（ADR 0010）。
    CREATE TABLE IF NOT EXISTS source_content_hotness (
      source_content_id TEXT PRIMARY KEY REFERENCES source_contents(id),
      hotness REAL NOT NULL
    ) STRICT;

    -- 命中记账：这一代次进工作包时，哪几条信号给它贡献了分。纯计数，不读内容。
    -- 按策略版本分开记——同一条代次在两版公式下各被加过分，那是两条不同的依据，
    -- 混成一个总数就没法回答「换了公式之后是不是更准了」。
    -- 还没下发过公式时用 'default' 这个哨兵：那段时间的依据同样要留着，
    -- Agent 写第一版公式靠的就是它，所以这里不指向 queue_strategies。
    CREATE TABLE IF NOT EXISTS queue_entry_signals (
      queue_entry_id TEXT NOT NULL REFERENCES queue_entries(id),
      strategy_id TEXT NOT NULL,
      signal TEXT NOT NULL,
      contribution REAL NOT NULL,
      PRIMARY KEY (queue_entry_id, strategy_id, signal)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS judgments (
      id TEXT PRIMARY KEY,
      brief_id TEXT NOT NULL REFERENCES briefs(id),
      brief_revision_id TEXT NOT NULL REFERENCES brief_revisions(id),
      queue_entry_id TEXT NOT NULL UNIQUE REFERENCES queue_entries(id),
      source_content_id TEXT NOT NULL REFERENCES source_contents(id),
      relevant INTEGER NOT NULL CHECK (relevant IN (0, 1)),
      what_it_is TEXT NOT NULL,
      evidence TEXT NOT NULL,
      uncertainty TEXT NOT NULL,
      -- 相关时是「为什么给你」，不相关时是淘汰理由。两种情况都必填：
      -- 用户问「这条为什么没给我」要答得出。
      why_for_you TEXT NOT NULL CHECK (why_for_you <> ''),
      judged_by TEXT NOT NULL CHECK (judged_by <> ''),
      created_at TEXT NOT NULL,
      CHECK (relevant = 0 OR (what_it_is <> '' AND evidence <> '' AND uncertainty <> ''))
    ) STRICT;
    CREATE INDEX IF NOT EXISTS judgments_by_brief ON judgments(brief_id, created_at DESC);

    -- 被某个判断引用为证据的来源内容。
    CREATE TABLE IF NOT EXISTS judgment_signals (
      judgment_id TEXT NOT NULL REFERENCES judgments(id),
      source_content_id TEXT NOT NULL REFERENCES source_contents(id),
      PRIMARY KEY (judgment_id, source_content_id)
    ) STRICT;

    -- Agent 自报的关联，意思只有一句「这跟那是同一件事」。Radar 存这条指向，
    -- 不合并、不校验、不因此改动排序或任何判断。
    CREATE TABLE IF NOT EXISTS judgment_relations (
      judgment_id TEXT NOT NULL REFERENCES judgments(id),
      related_judgment_id TEXT NOT NULL REFERENCES judgments(id),
      PRIMARY KEY (judgment_id, related_judgment_id)
    ) STRICT;

    -- 交付记录：只说明什么已经交付到哪个去处过，**不保存输出本身**。
    -- 去处是 Agent 自报的标签（周报、obsidian），Radar 不预设可选值也不校验。
    -- 外部引用（Obsidian 路径、note id）同样不校验不解释，只保证它还在——
    -- 同一件事三周后再冒出来，Agent 靠它找回上次那条笔记去改，而不是另起一条。
    CREATE TABLE IF NOT EXISTS deliveries (
      judgment_id TEXT NOT NULL REFERENCES judgments(id),
      destination TEXT NOT NULL CHECK (destination <> ''),
      external_reference TEXT,
      delivered_at TEXT NOT NULL,
      PRIMARY KEY (judgment_id, destination)
    ) STRICT;

    -- 幂等键防的是同一调用者的网络重试，不是重复判断——那由队列代次挡下。
    CREATE TABLE IF NOT EXISTS idempotent_judgments (
      key TEXT PRIMARY KEY,
      judgment_id TEXT NOT NULL REFERENCES judgments(id),
      created_at TEXT NOT NULL
    ) STRICT;

    -- 只有用户明说的才是反馈。可以挂在一个具体判断上，也可以只挂在 Brief 上。
    -- 处置标签由 Agent 归纳，Radar 不预设可选值也不解释。
    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      brief_id TEXT NOT NULL REFERENCES briefs(id),
      judgment_id TEXT REFERENCES judgments(id),
      disposition TEXT NOT NULL CHECK (disposition <> ''),
      note TEXT NOT NULL CHECK (note <> ''),
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS feedback_by_brief ON feedback(brief_id, created_at);

    CREATE TABLE IF NOT EXISTS acquisition_runs (
      id TEXT PRIMARY KEY,
      endpoint_id TEXT NOT NULL REFERENCES endpoints(id),
      status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
      started_at TEXT NOT NULL,
      completed_at TEXT,
      new_content_count INTEGER NOT NULL DEFAULT 0,
      seen_content_count INTEGER NOT NULL DEFAULT 0,
      error TEXT
    ) STRICT;
    CREATE INDEX IF NOT EXISTS runs_by_endpoint ON acquisition_runs(endpoint_id, started_at DESC);

    CREATE TABLE IF NOT EXISTS instance_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;
  `);
}
