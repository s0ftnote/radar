import { XMLParser, XMLValidator } from "fast-xml-parser";

export type FeedEntry = {
  /** 内容身份用 feed 自带的 guid / id，不用标题正文的整体哈希。 */
  externalId: string;
  title: string;
  originUrl: string;
  /** 采集那一刻的正文快照（ADR 0015）。只快照文本，图片视频留地址。 */
  body: string;
  publishedAt: string | null;
  rawPayload: string;
  /**
   * 平台自带的热度。只有平台自己给了才有——RSS 没有这个东西，推送渠道可能有。
   * Radar 不理解它，只把它当一个数（ADR 0010）。
   */
  hotness?: number;
};

export type ParsedFeed = { name: string; entries: FeedEntry[] };

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  removeNSPrefix: true,
  parseTagValue: false,
});

export async function fetchFeed(url: string): Promise<ParsedFeed> {
  const xml = await fetchFeedXml(url);

  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    throw new Error(`无法解析 RSS/Atom：Feed XML 无效：${validation.err.msg}（第 ${validation.err.line} 行）。`);
  }

  try {
    return normalizeFeed(parser.parse(xml) as Record<string, unknown>, url);
  } catch (error) {
    if (error instanceof FeedFormatError) throw error;
    throw new Error(`无法解析 RSS/Atom：${error instanceof Error ? error.message : String(error)}`);
  }
}

async function fetchFeedXml(url: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error("来源连接超时，请确认 URL 可公开访问后重试。");
    }
    throw new Error(
      `无法连接来源，请检查 URL 或网络后重试：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) throw new Error(`来源返回 HTTP ${response.status}，请检查 URL 或稍后重试。`);

  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > 5_000_000) throw new Error("Feed 超过 5 MB，当前本地切片不会保存它。");
  let xml: string;
  try {
    xml = await response.text();
  } catch (error) {
    throw new Error(
      `读取来源内容失败，请稍后重试：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (xml.length > 5_000_000) throw new Error("Feed 超过 5 MB，当前本地切片不会保存它。");
  return xml;
}

function normalizeFeed(document: Record<string, unknown>, feedUrl: string): ParsedFeed {
  const rss = asRecord(document.rss);
  const channel = rss ? asRecord(first(rss.channel)) : null;
  if (channel) {
    return {
      name: text(channel.title) || new URL(feedUrl).hostname,
      entries: array(channel.item).map((item, index) => normalizeRssEntry(item, index, feedUrl)),
    };
  }

  const atom = asRecord(document.feed);
  if (atom) {
    return {
      name: text(atom.title) || new URL(feedUrl).hostname,
      entries: array(atom.entry).map((entry, index) => normalizeAtomEntry(entry, index, feedUrl)),
    };
  }

  throw new FeedFormatError("无法解析 RSS/Atom：文档中没有 RSS channel 或 Atom feed。");
}

/**
 * 内容身份优先认 feed 自带的 guid / id，其次认条目链接。两个都没有时只能退到
 * 位置——用标题或正文做身份会让一次编辑变成一条新内容，重复入队。
 */
function normalizeRssEntry(value: unknown, index: number, feedUrl: string): FeedEntry {
  const entry = asRecord(value) ?? {};
  const title = text(entry.title) || `未命名来源内容 ${index + 1}`;
  const entryUrl = text(entry.link);
  const publishedAt = text(entry.pubDate);
  const originUrl = entryUrl || feedUrl;
  return {
    externalId: text(entry.guid) || entryUrl || `${feedUrl}#${index}`,
    title,
    originUrl,
    body: text(entry.encoded) || text(entry.description) || "",
    publishedAt: dateOrNull(publishedAt),
    rawPayload: JSON.stringify(entry),
  };
}

function normalizeAtomEntry(value: unknown, index: number, feedUrl: string): FeedEntry {
  const entry = asRecord(value) ?? {};
  const title = text(entry.title) || `未命名来源内容 ${index + 1}`;
  const entryUrl = atomLink(entry.link);
  const publishedAt = text(entry.published) || text(entry.updated);
  const originUrl = entryUrl || feedUrl;
  return {
    externalId: text(entry.id) || entryUrl || `${feedUrl}#${index}`,
    title,
    originUrl,
    body: text(entry.content) || text(entry.summary) || "",
    publishedAt: dateOrNull(publishedAt),
    rawPayload: JSON.stringify(entry),
  };
}

function atomLink(value: unknown): string {
  for (const link of array(value)) {
    if (typeof link === "string") return link;
    const record = asRecord(link);
    if (record && (!record["@_rel"] || record["@_rel"] === "alternate")) {
      const href = text(record["@_href"]);
      if (href) return href;
    }
  }
  return "";
}

function text(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  const record = asRecord(value);
  return record ? text(record["#text"] ?? record.__cdata) : "";
}

function array(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function dateOrNull(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

class FeedFormatError extends Error {}
