import { createServer, type IncomingMessage, type Server } from "node:http";

export type ProjectIsolationAgentFixture = {
  endpoint: string;
  close(): Promise<void>;
};

export async function startProjectIsolationAgentFixture(): Promise<ProjectIsolationAgentFixture> {
  let projectBRevisionOneAttempts = 0;
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/judge") {
      response.writeHead(404).end();
      return;
    }

    const body = await requestJson(request);
    const brief = String(asRecord(body.radarBriefRevision)?.description);
    const sourceBody = String(asRecord(body.sourceVersion)?.body);
    await new Promise((resolve) => setTimeout(resolve, 350));

    if (brief.includes("Project A") && sourceBody.includes("Revision 1")) {
      sendJson(response, 200, matched({
        key: "shared-local-evidence",
        title: "A 的本地证据需求",
        judgment: "Project A 判断开发者需要保留本地证据链。",
        rationale: "来源版本与 Project A 的 Brief 直接相关。",
        quote: "Revision 1: developers want evidence they can keep.",
      }));
      return;
    }
    if (brief.includes("Project A") && sourceBody.includes("Revision 2")) {
      sendJson(response, 200, matched({
        key: "shared-local-evidence",
        title: "A 的本地证据需求",
        judgment: "Project A 判断开发者需要保留本地证据链。",
        rationale: "新版本为 Project A 的既有判断补充证据。",
        quote: "Revision 2: developers want evidence they can keep.",
      }));
      return;
    }
    if (brief.includes("Project B") && sourceBody.includes("Revision 1")) {
      projectBRevisionOneAttempts += 1;
      if (projectBRevisionOneAttempts === 1) {
        sendJson(response, 503, { error: "project B fixture unavailable" });
        return;
      }
      sendJson(response, 200, matched({
        key: "shared-local-evidence",
        title: "B 的可检查竞争信号",
        judgment: "Project B 判断这份来源构成竞争情报信号。",
        rationale: "同一来源版本依据 Project B 的 Brief 形成独立判断。",
        quote: "Revision 1: developers want evidence they can keep.",
      }));
      return;
    }
    if (brief.includes("Project B") && sourceBody.includes("Revision 2")) {
      sendJson(response, 200, {
        match: false,
        reason: "这个版本不符合 Project B 的竞争信号边界。",
      });
      return;
    }
    sendJson(response, 422, { error: "unexpected project isolation input" });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Agent fixture did not bind a port.");
  return {
    endpoint: `http://127.0.0.1:${address.port}/judge`,
    close: () => closeServer(server),
  };
}

function matched(input: {
  key: string;
  title: string;
  judgment: string;
  rationale: string;
  quote: string;
}) {
  return {
    match: true,
    judgmentKey: input.key,
    title: input.title,
    judgment: input.judgment,
    rationale: input.rationale,
    evidence: { quote: input.quote },
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
