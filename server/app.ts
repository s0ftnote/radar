import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { collectAllEndpoints, collectEndpoint } from "../lib/acquisition.js";
import { createBrief, getBrief, listBriefs } from "../lib/briefs.js";
import { radarDataDirectory } from "../lib/data-directory.js";
import { listEndpoints } from "../lib/endpoints.js";
import { listFeedback, recordFeedback } from "../lib/feedback.js";
import { listJudgments, QueueEntryConsumedError, recordJudgment } from "../lib/judgments.js";
import { enqueueCurrentPage } from "../lib/queue.js";
import {
  assembleWorkPackage,
  defaultWorkPackageLimit,
  maximumWorkPackageLimit,
} from "../lib/work-package.js";
import { renderHomePage } from "./home-page.js";
import { packageRoot } from "./package-root.js";
import { radarVersion } from "./version.js";

/**
 * HTTP 是 Radar 的内部实现，不是契约（ADR 0012）——契约是 `radar` 的命令面。
 * 这些路由只服务本机的 CLI 与那张来源页。
 */
export function createRadarApp(): Hono {
  const app = new Hono();

  app.get("/health", (context) =>
    context.json({ ok: true, version: radarVersion(), dataDirectory: radarDataDirectory() }),
  );

  app.get("/", (context) =>
    context.html(renderHomePage({ version: radarVersion(), dataDirectory: radarDataDirectory() })),
  );

  // 字体与样式住在包里，不在 cwd 里——`radar` 装成全局命令后能在任意目录起。
  app.use("/assets/*", serveStatic({ root: packageRoot() }));

  app.get("/endpoints", (context) => context.json(listEndpoints()));

  // 点名一个端点是「现在就去看一眼」，可以越过退避；全催一遍不行，那会把
  // 退避整个废掉（ADR 0010）。
  app.post("/endpoints/:endpointId/collect", async (context) =>
    context.json(
      await collectEndpoint(context.req.param("endpointId"), {
        force: context.req.query("force") === "true",
      }),
    ),
  );

  app.post("/collect", async (context) => context.json(await collectAllEndpoints()));

  app.get("/briefs", (context) => context.json(listBriefs()));

  app.post("/briefs", async (context) => {
    const body = await jsonBody(context.req.raw);
    const brief = createBrief({
      name: requiredText(body.name, "Brief 名称"),
      body: requiredText(body.body, "Brief 正文"),
    });
    // 新建的 Brief 立刻看得见各端点当前那一页，不必等下一次采集。
    enqueueCurrentPage(brief.id);
    return context.json(brief, 201);
  });

  app.use("/briefs/:briefId/*", async (context, next) => {
    if (!getBrief(context.req.param("briefId"))) {
      throw new HTTPException(404, { message: "找不到这个 Radar Brief。" });
    }
    await next();
  });

  app.get("/briefs/:briefId", (context) => context.json(getBrief(context.req.param("briefId"))));

  app.get("/briefs/:briefId/work-package", (context) => {
    const requested = Number(context.req.query("limit") ?? defaultWorkPackageLimit);
    if (!Number.isInteger(requested) || requested < 1) {
      throw new HTTPException(400, { message: "`limit` 需要一个正整数。" });
    }
    // 工作包有上限：一次给多少由服务端说了算，客户端要不到无限长的一包。
    const limit = Math.min(requested, maximumWorkPackageLimit);
    return context.json(assembleWorkPackage(context.req.param("briefId"), limit));
  });

  app.get("/briefs/:briefId/judgments", (context) =>
    context.json(listJudgments(context.req.param("briefId"))),
  );

  app.get("/briefs/:briefId/feedback", (context) =>
    context.json(listFeedback(context.req.param("briefId"))),
  );

  app.post("/briefs/:briefId/feedback", async (context) => {
    const body = await jsonBody(context.req.raw);
    return context.json(
      recordFeedback({
        briefId: context.req.param("briefId"),
        judgmentId: typeof body.judgmentId === "string" ? body.judgmentId : null,
        disposition: requiredText(body.disposition, "处置标签"),
        note: requiredText(body.note, "反馈正文"),
      }),
      201,
    );
  });

  app.post("/judgments", async (context) => {
    const body = await jsonBody(context.req.raw);
    const relevant = body.relevant === true;
    const judgment = domainCall(() =>
      recordJudgment({
        queueEntryId: requiredText(body.queueEntryId, "队列代次 id"),
        relevant,
        whatItIs: relevant ? requiredText(body.whatItIs, "「是什么」") : undefined,
        evidence: relevant ? requiredText(body.evidence, "「凭什么」") : undefined,
        uncertainty: relevant ? requiredText(body.uncertainty, "「哪里不确定」") : undefined,
        whyForYou: requiredText(body.whyForYou, relevant ? "「为什么给你」" : "淘汰理由"),
        judgedBy: requiredText(body.judgedBy, "判断者"),
        signalContentIds: textList(body.signalContentIds),
        idempotencyKey:
          typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined,
      }),
    );
    return context.json(judgment, 201);
  });

  app.onError((error, context) => {
    if (error instanceof HTTPException) return context.json({ error: error.message }, error.status);
    if (error instanceof QueueEntryConsumedError) {
      return context.json({ error: error.message }, 409);
    }
    console.error("[Radar]", error);
    return context.json({ error: "Radar 服务内部错误。" }, 500);
  });

  return app;
}

async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    throw new HTTPException(400, { message: "请求体必须是 JSON。" });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HTTPException(400, { message: "请求体必须是一个 JSON 对象。" });
  }
  return parsed as Record<string, unknown>;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HTTPException(400, { message: `${label}不能为空。` });
  }
  return value.trim();
}

function textList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === "string");
}

/** 领域层用普通 Error 表达用户可修正的输入问题，到了 HTTP 边界它们是 400。 */
function domainCall<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof HTTPException || error instanceof QueueEntryConsumedError) throw error;
    throw new HTTPException(400, {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
