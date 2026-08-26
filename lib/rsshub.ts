import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { radarDataDirectory } from "./data-directory.js";
import { database } from "./database.js";
import { packageRoot } from "../server/package-root.js";
import { safeFetch } from "./safe-fetch.js";

/**
 * RSSHub **不是采集渠道**。它在 Radar 里只是一份规则快照：粘网址那一刻用一次，
 * 把网址翻成一条 RSSHub 路由；挑中之后那个端点就是一个普通的 RSS/Atom 端点，
 * 跟规则库彻底脱钩，之后规则怎么变都不影响它。
 *
 * 规则随版本打包（`data/rsshub-rules.json`，取自 RSSHub 官方 routes.json 里
 * 每条路由自带的 radar 规则）。用户填了自己那台实例的地址，就每天从他自己
 * 那台刷新一次——不填就跳过这一步匹配，Radar 不替他找一台公共实例。
 */
export type RsshubRule = { source: string; target: string; name: string };

export type RuleSnapshot = { takenFrom: string; takenAt: string; rules: RsshubRule[] };

export type RsshubCandidate = { name: string; feedUrl: string; route: string };

const baseUrlKey = "rsshub_base_url";
const refreshedAtKey = "rsshub_rules_refreshed_at";
const refreshIntervalMilliseconds = 24 * 60 * 60 * 1000;

/** 用户自己那台 RSSHub 的地址。这是页面上唯一那处实例级设置（ADR 0013）。 */
export function rsshubBaseUrl(): string | null {
  const row = database()
    .prepare("SELECT value FROM instance_settings WHERE key = ?")
    .get(baseUrlKey) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setRsshubBaseUrl(url: string | null): void {
  const db = database();
  if (url === null) {
    db.prepare("DELETE FROM instance_settings WHERE key = ?").run(baseUrlKey);
    return;
  }
  db.prepare(
    "INSERT INTO instance_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(baseUrlKey, new URL(url).origin);
}

/**
 * 没填地址就一条候选都不给——这一步直接跳过，不是「够不着」。填了就用规则
 * 匹配；规则先看用户那台刷新下来的，没有就用随版本来的那份。
 */
export function matchRsshubRoutes(pastedUrl: string): RsshubCandidate[] {
  const base = rsshubBaseUrl();
  if (!base) return [];

  const url = new URL(pastedUrl);
  const host = url.hostname.replace(/^www\./, "");
  const path = url.pathname.replace(/\/$/, "");

  const seen = new Set<string>();
  const candidates: RsshubCandidate[] = [];
  for (const rule of currentRules()) {
    const route = applyRule(rule, host, path);
    if (!route || seen.has(route)) continue;
    seen.add(route);
    candidates.push({ name: rule.name, route, feedUrl: `${base}${route}` });
  }
  return candidates;
}

/**
 * 一条 radar 规则长这样：`github.com/:user/:repo/issues` → `/github/issue/:user/:repo`。
 * `:name` 吃掉一整段，`*` 吃掉剩下的全部。目标里没填上的参数（RSSHub 写成
 * `:number?`）直接去掉——那是可选参数。
 */
function applyRule(rule: RsshubRule, host: string, path: string): string | null {
  const [ruleHost, ...ruleSegments] = rule.source.split("/");
  if (!ruleHost || ruleHost.replace(/^www\./, "") !== host) return null;

  const pathSegments = path.split("/").filter(Boolean);
  const values = new Map<string, string>();
  for (const [index, segment] of ruleSegments.entries()) {
    if (segment === "*") return fill(rule.target, values);
    const actual = pathSegments[index];
    if (actual === undefined) return null;
    if (segment.startsWith(":")) values.set(segment.slice(1).replace(/\?$/, ""), actual);
    else if (segment !== actual) return null;
  }
  if (pathSegments.length !== ruleSegments.length) return null;
  return fill(rule.target, values);
}

function fill(target: string, values: Map<string, string>): string | null {
  const filled = target
    .split("/")
    .map((segment) => {
      if (!segment.startsWith(":")) return segment;
      const optional = segment.endsWith("?");
      const value = values.get(segment.slice(1).replace(/\?$/, ""));
      if (value) return encodeURIComponent(value);
      return optional ? null : undefined;
    })
    .filter((segment) => segment !== null);
  // 必填参数没填上，这条规则就不适用。
  if (filled.some((segment) => segment === undefined)) return null;
  return filled.join("/");
}

/**
 * 规则每天从用户自己那台实例刷新一次，存在数据目录里。刷不下来就接着用手上
 * 那份——规则过期只是少几条候选，不该让粘网址这件事失败。
 */
export async function refreshRulesIfStale(now = new Date()): Promise<boolean> {
  const base = rsshubBaseUrl();
  if (!base) return false;

  const db = database();
  const row = db.prepare("SELECT value FROM instance_settings WHERE key = ?").get(refreshedAtKey) as
    | { value: string }
    | undefined;
  if (row && now.getTime() - Date.parse(row.value) < refreshIntervalMilliseconds) return false;

  try {
    // 自建的 RSSHub 常常就在 localhost 或者局域网里——那是用户自己填的地址。
    const response = await safeFetch(`${base}/api/namespace`, {
      accept: "application/json",
      allowPrivateOrigin: true,
    });
    const rules = extractRules(JSON.parse(response.body) as Record<string, unknown>);
    if (rules.length === 0) return false;
    writeFileSync(
      refreshedRulesPath(),
      JSON.stringify({ takenFrom: base, takenAt: now.toISOString(), rules }),
    );
  } catch {
    // 刷不下来就接着用手上那份。
    return false;
  }

  db.prepare(
    "INSERT INTO instance_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(refreshedAtKey, now.toISOString());
  return true;
}

/** RSSHub 的 `/api/namespace` 与官方 routes.json 是同一个形状。 */
export function extractRules(namespaces: Record<string, unknown>): RsshubRule[] {
  const rules: RsshubRule[] = [];
  for (const [namespace, value] of Object.entries(namespaces)) {
    const routes = (value as { routes?: Record<string, unknown> }).routes ?? {};
    for (const route of Object.values(routes)) {
      const typed = route as {
        path?: string;
        name?: string;
        radar?: Array<{ source?: string[]; target?: string }>;
      };
      for (const rule of typed.radar ?? []) {
        for (const source of rule.source ?? []) {
          const target = rule.target ?? typed.path;
          if (typeof target !== "string" || !target.startsWith("/")) continue;
          rules.push({ source, target: `/${namespace}${target}`, name: typed.name ?? namespace });
        }
      }
    }
  }
  return rules;
}

function currentRules(): RsshubRule[] {
  return (readSnapshot(refreshedRulesPath()) ?? readSnapshot(shippedRulesPath()))?.rules ?? [];
}

function readSnapshot(path: string): RuleSnapshot | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as RuleSnapshot;
  } catch {
    return null;
  }
}

function shippedRulesPath(): string {
  return resolve(packageRoot(), "data/rsshub-rules.json");
}

function refreshedRulesPath(): string {
  return resolve(radarDataDirectory(), "rsshub-rules.json");
}
