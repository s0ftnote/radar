/** 外来的 JSON / XML 解析结果里，这个值是不是一个能按键取的对象。 */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
