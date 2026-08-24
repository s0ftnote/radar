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

export type ReportGenerationInput = {
  projectId: string;
  purpose: string;
  audience: string;
  angle: string;
  sourceCutoffAt: string;
  intelligenceRevisions: Array<{
    id: string;
    intelligenceItemId: string;
    revisionNumber: number;
    title: string;
    judgment: string;
    rationale: string;
    signals: Array<{
      id: string;
      evidenceQuote: string;
      sourceVersionId: string;
      sourceVersionNumber: number;
    }>;
  }>;
};

export type AgentReportGeneration = {
  title: string;
  claims: Array<{
    text: string;
    intelligenceItemRevisionId: string;
    signalIds: string[];
  }>;
};

export interface RadarAgent {
  readonly kind: string;
  judge(input: AgentJudgmentInput): Promise<AgentJudgment>;
  generateReport(input: ReportGenerationInput): Promise<AgentReportGeneration>;
}

export function configuredRadarAgent(): RadarAgent {
  return new HttpJsonRadarAgent();
}

class HttpJsonRadarAgent implements RadarAgent {
  readonly kind = "http-json";

  async judge(input: AgentJudgmentInput): Promise<AgentJudgment> {
    return validateJudgment(await this.call("judge", input), input);
  }

  async generateReport(input: ReportGenerationInput): Promise<AgentReportGeneration> {
    return validateReportGeneration(await this.call("generate_report", input), input);
  }

  private async call(operation: "judge" | "generate_report", input: unknown): Promise<unknown> {
    const endpoint = agentEndpoint();
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { ...agentHeaders(), "x-radar-operation": operation },
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
    return value;
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

function validateReportGeneration(
  value: unknown,
  input: ReportGenerationInput,
): AgentReportGeneration {
  const result = asRecord(value);
  if (!result || !Array.isArray(result.claims) || result.claims.length === 0) {
    throw new Error("Agent Report 响应必须包含至少一项 claims。");
  }
  const revisions = new Map(input.intelligenceRevisions.map((revision) => [revision.id, revision]));
  const usedRevisions = new Set<string>();
  const claims = result.claims.map((value, index) => {
    const claim = asRecord(value);
    if (!claim) throw new Error(`Agent Report 主张 ${index + 1} 不是有效对象。`);
    const intelligenceItemRevisionId = requiredString(
      claim.intelligenceItemRevisionId,
      `claims[${index}].intelligenceItemRevisionId`,
    );
    const revision = revisions.get(intelligenceItemRevisionId);
    if (!revision) throw new Error("Agent Report 主张引用了未选择的情报条目修订。");
    if (!Array.isArray(claim.signalIds) || claim.signalIds.length === 0) {
      throw new Error("Agent Report 主张必须引用至少一个本次输入中的 Signal。");
    }
    const allowedSignals = new Set(revision.signals.map((signal) => signal.id));
    const signalIds = [...new Set(claim.signalIds.map((signalId) => requiredString(signalId, "signalIds")))];
    if (signalIds.some((signalId) => !allowedSignals.has(signalId))) {
      throw new Error("Agent Report 主张引用了不属于该情报条目修订输入的 Signal。");
    }
    usedRevisions.add(intelligenceItemRevisionId);
    return {
      text: requiredString(claim.text, `claims[${index}].text`),
      intelligenceItemRevisionId,
      signalIds,
    };
  });
  if (usedRevisions.size !== revisions.size) {
    throw new Error("Agent Report 必须为每个选中的情报条目修订形成至少一项主张。");
  }
  return { title: requiredString(result.title, "title"), claims };
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
