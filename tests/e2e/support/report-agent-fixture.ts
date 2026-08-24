import { createServer, type IncomingMessage, type Server } from "node:http";

export type ReportAgentFixture = {
  endpoint: string;
  token: string;
  close(): Promise<void>;
};

export async function startReportAgentFixture(): Promise<ReportAgentFixture> {
  const token = "report-fixture-secret";
  let failRecoveryAngleOnce = true;
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/agent") {
      response.writeHead(404).end();
      return;
    }
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401).end();
      return;
    }

    const body = await requestJson(request);
    const operation = request.headers["x-radar-operation"] ?? "judge";
    await new Promise((resolve) => setTimeout(resolve, 400));
    if (operation === "generate_report") {
      const angle = String(body.angle);
      if (angle.includes("先失败") && failRecoveryAngleOnce) {
        failRecoveryAngleOnce = false;
        sendJson(response, 503, { error: "fixture report generation failed" });
        return;
      }
      const revisions = Array.isArray(body.intelligenceRevisions)
        ? body.intelligenceRevisions.map(asRecord).filter((value): value is Record<string, unknown> => value !== null)
        : [];
      sendJson(response, 200, {
        title: `${String(body.purpose)} · 固定快照`,
        claims: revisions.map((revision) => {
          const signals = Array.isArray(revision.signals)
            ? revision.signals.map(asRecord).filter((value): value is Record<string, unknown> => value !== null)
            : [];
          return {
            text: `${String(revision.title)}：${String(revision.judgment)}`,
            epistemicRole: "inference",
            intelligenceItemRevisionId: String(revision.id),
            signalIds: signals.slice(0, 1).map((signal) => String(signal.id)),
          };
        }),
      });
      return;
    }

    const sourceVersion = asRecord(body.sourceVersion);
    const sourceBody = String(sourceVersion?.body);
    const revision = sourceBody.includes("Revision 2") ? 2 : 1;
    sendJson(response, 200, {
      match: true,
      judgmentKey: "reportable-local-evidence",
      title: "可报告的本地证据需求",
      judgment: "开发者需要把本地证据链组织成可追溯主张。",
      rationale: "来源明确表达了保存和复用证据的需求。",
      evidence: { quote: `Revision ${revision}: developers want evidence they can keep.` },
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Report Agent fixture did not bind a port.");
  return {
    endpoint: `http://127.0.0.1:${address.port}/agent`,
    token,
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
