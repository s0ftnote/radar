export function formatDate(value: string | null): string {
  if (!value) return "暂无";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function formatDateTime(value: string | null): string {
  if (!value) return "暂无";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function excerpt(value: string, maximum = 110): string {
  const flattened = value.replace(/\s+/g, " ").trim();
  return Array.from(flattened).slice(0, maximum).join("") +
    (Array.from(flattened).length > maximum ? "…" : "");
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "未知平台";
  }
}

export function safeExternalUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function contentStateLabel(state: ContentState): string {
  if (state === "for_you") return "给你看";
  if (state === "filtered") return "判过没给";
  return "待判断";
}
import type { ContentState } from "../lib/brief-content.js";
