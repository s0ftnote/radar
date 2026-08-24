import { XMLParser, XMLValidator } from "fast-xml-parser";

export type FeedEntry = {
  externalId: string;
  title: string;
  originUrl: string;
  body: string;
  publishedAt: string | null;
  rawPayload: string;
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
  const response = await fetch(url, {
    headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
    redirect: "follow",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`来源返回 HTTP ${response.status}，请检查 URL 或稍后重试。`);

  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > 5_000_000) throw new Error("Feed 超过 5 MB，当前本地切片不会保存它。");
  const xml = await response.text();
  if (xml.length > 5_000_000) throw new Error("Feed 超过 5 MB，当前本地切片不会保存它。");

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

function normalizeRssEntry(value: unknown, index: number, feedUrl: string): FeedEntry {
  const entry = asRecord(value) ?? {};
  const title = text(entry.title) || `未命名来源内容 ${index + 1}`;
  const originUrl = text(entry.link) || feedUrl;
  return {
    externalId: text(entry.guid) || originUrl || `${title}:${text(entry.pubDate)}`,
    title,
    originUrl,
    body: text(entry.encoded) || text(entry.description) || "",
    publishedAt: dateOrNull(text(entry.pubDate)),
    rawPayload: JSON.stringify(entry),
  };
}

function normalizeAtomEntry(value: unknown, index: number, feedUrl: string): FeedEntry {
  const entry = asRecord(value) ?? {};
  const title = text(entry.title) || `未命名来源内容 ${index + 1}`;
  const originUrl = atomLink(entry.link) || feedUrl;
  return {
    externalId: text(entry.id) || originUrl || `${title}:${text(entry.updated)}`,
    title,
    originUrl,
    body: text(entry.content) || text(entry.summary) || "",
    publishedAt: dateOrNull(text(entry.published) || text(entry.updated)),
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
