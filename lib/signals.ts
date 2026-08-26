/**
 * 信号的名字。算分时贴上、统计时按它归组——两边必须说同一个词，所以只在
 * 这里写一次。信号只取 Radar 自己就有的机械事实（ADR 0010）。
 */
export const signals = {
  freshness: "freshness",
  endpointWeight: "endpoint_weight",
  hotness: "hotness",
  hitRate: "hit_rate",
  keyword: (term: string): string => `keyword:${term}`,
} as const;
