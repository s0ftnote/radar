import { createServer, type IncomingMessage, type Server } from "node:http";

export type AgentFixture = {
  endpoint: string;
  token: string;
  requestCount(): number;
  delayNextResponse(): void;
  close(): Promise<void>;
};

export async function startAgentFixture(): Promise<AgentFixture> {
  const token = "fixture-agent-secret";
  let requests = 0;
  let revisionThreeAttempts = 0;
  let delayNextResponse = false;
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/judge") {
      response.writeHead(404).end();
      return;
    }
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401).end();
      return;
    }

    requests += 1;
    const body = await requestJson(request);
    const sourceBody = String(body.sourceVersion && asRecord(body.sourceVersion)?.body);
    if (delayNextResponse) {
      delayNextResponse = false;
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    } else {
      await new Promise((resolve) => setTimeout(resolve, 450));
    }

    if (sourceBody.includes("Revision 1")) {
      sendJson(response, 200, {
        match: true,
        judgmentKey: "inspectable-local-workbenches",
        title: "可检查的本地工作台需求",
        judgment: "用户需要在本地保存可检查的来源事实与判断链。",
        rationale: "来源明确表达了保留证据的需求，与当前 Radar Brief 直接相关。",
        evidence: {
          quote: "Revision 1: developers want evidence they can keep.",
        },
      });
      return;
    }
    if (sourceBody.includes("Revision 2")) {
      sendJson(response, 200, {
        match: false,
        reason: "这次内容变化没有形成新的需求判断。",
      });
      return;
    }
    if (sourceBody.includes("Revision 3")) {
      revisionThreeAttempts += 1;
      if (revisionThreeAttempts === 1) {
        sendJson(response, 503, { error: "fixture unavailable" });
        return;
      }
      sendJson(response, 200, {
        match: true,
        judgmentKey: "provenance-first-research",
        title: "出处优先的研究流程需求",
        judgment: "研究者需要让每项判断都能回到具体来源版本。",
        rationale: "来源再次强调证据保留，并形成了独立的出处判断。",
        evidence: {
          quote: "Revision 3: developers want evidence they can keep.",
        },
      });
      return;
    }
    if (sourceBody.includes("Revision 4")) {
      sendJson(response, 200, {
        match: true,
        judgmentKey: "inspectable-local-workbenches",
        title: "可检查的本地工作台需求",
        judgment: "用户需要在本地保存可检查的来源事实与判断链。",
        rationale: "来源再次表达了保留证据的需求，与既有判断身份一致。",
        evidence: {
          quote: "Revision 4: developers want evidence they can keep.",
        },
      });
      return;
    }
    sendJson(response, 422, { error: "unexpected fixture input" });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Agent fixture did not bind a port.");

  return {
    endpoint: `http://127.0.0.1:${address.port}/judge`,
    token,
    requestCount: () => requests,
    delayNextResponse: () => (delayNextResponse = true),
    close: () => closeServer(server),
  };
}

async function requestJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  let body = "";
  for await (const chunk of request) body += chunk;
  return JSON.parse(body) as Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function sendJson(response: import("node:http").ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
