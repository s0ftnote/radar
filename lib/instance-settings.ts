import { database } from "./database.js";

/** 实例级设置：一个 key 一行，跟着数据目录走，不跟着 Brief 走。 */
export function instanceSetting(key: string): string | null {
  const row = database().prepare("SELECT value FROM instance_settings WHERE key = ?").get(key) as
    { value: string } | undefined;
  return row?.value ?? null;
}

export function setInstanceSetting(key: string, value: string | null): void {
  const db = database();
  if (value === null) {
    db.prepare("DELETE FROM instance_settings WHERE key = ?").run(key);
    return;
  }
  db.prepare(
    `INSERT INTO instance_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}
