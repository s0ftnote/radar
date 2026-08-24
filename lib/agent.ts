export type AgentJudgmentInput = {
  radarBriefRevision: {
    id: string;
    description: string;
  };
  sourceVersion: {
    id: string;
    title: string;
    body: string;
    originUrl: string;
    publishedAt: string | null;
    acquiredAt: string;
  };
};

export type AgentJudgment =
  | { match: false; reason: string }
  | {
      match: true;
      judgmentKey: string;
      title: string;
      judgment: string;
      rationale: string;
      evidence: {
        quote: string;
        field: "title" | "body";
        start: number;
        end: number;
      };
    };

export interface RadarAgent {
  readonly kind: string;
  judge(input: AgentJudgmentInput): Promise<AgentJudgment>;
}

export function configuredRadarAgent(): RadarAgent {
  return new HttpJsonRadarAgent();
}

class HttpJsonRadarAgent implements RadarAgent {
  readonly kind = "http-json";

  async judge(input: AgentJudgmentInput): Promise<AgentJudgment> {
    const endpoint = agentEndpoint();
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new Error("Agent 调用超时，请检查本地适配器后重试。");
      }
      throw new Error("无法连接本地 Agent 适配器，请检查 RADAR_AGENT_ENDPOINT 后重试。");
    }
    if (!response.ok) {
      throw new Error(`Agent 返回 HTTP ${response.status}，请检查本地适配器后重试。`);
    }

    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new Error("Agent 返回的不是有效 JSON，请检查适配器契约后重试。");
    }
    return validateJudgment(value, input);
  }
}

function agentEndpoint(): string {
  const configured = process.env.RADAR_AGENT_ENDPOINT;
  if (!configured) {
    throw new Error("未配置 RADAR_AGENT_ENDPOINT，请在本地环境设置 Agent 适配器后重试。");
  }
  let endpoint: URL;
  try {
    endpoint = new URL(configured);
  } catch {
    throw new Error("RADAR_AGENT_ENDPOINT 不是有效的 http:// 或 https:// URL。");
  }
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
    throw new Error("RADAR_AGENT_ENDPOINT 只支持 http:// 或 https:// URL。");
  }
  return endpoint.toString();
}

function agentHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = process.env.RADAR_AGENT_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

function validateJudgment(value: unknown, input: AgentJudgmentInput): AgentJudgment {
  const result = asRecord(value);
  if (!result || typeof result.match !== "boolean") {
    throw new Error("Agent 响应缺少布尔字段 match，请检查适配器契约后重试。");
  }
  if (!result.match) {
    return { match: false, reason: requiredString(result.reason, "reason") };
  }

  const evidence = asRecord(result.evidence);
  if (!evidence) throw new Error("Agent 匹配响应缺少 evidence，请检查适配器契约后重试。");
  const quote = requiredString(evidence.quote, "evidence.quote");
  const titleStart = input.sourceVersion.title.indexOf(quote);
  const bodyStart = input.sourceVersion.body.indexOf(quote);
  if (titleStart < 0 && bodyStart < 0) {
    throw new Error("Agent 证据摘录无法在当前来源版本中定位，请修正适配器响应后重试。");
  }
  const field = titleStart >= 0 ? "title" : "body";
  const start = titleStart >= 0 ? titleStart : bodyStart;
  return {
    match: true,
    judgmentKey: requiredString(result.judgmentKey, "judgmentKey"),
    title: requiredString(result.title, "title"),
    judgment: requiredString(result.judgment, "judgment"),
    rationale: requiredString(result.rationale, "rationale"),
    evidence: {
      quote,
      field,
      start,
      end: start + quote.length,
    },
  };
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Agent 响应字段 ${field} 必须是非空字符串。`);
  }
  return value.trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
