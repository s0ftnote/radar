import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { createBrief, getBrief, listBriefs } from "../lib/briefs.js";
import { radarDataDirectory } from "../lib/data-directory.js";
import { listJudgments, listPendingContents, recordJudgment } from "../lib/judgments.js";
import {
  collectSource,
  linkSavedSource,
  listAvailableInstanceSources,
  listBriefSources,
  stopUsingSource,
  validateAndLinkSource,
} from "../lib/sources.js";
import { renderHomePage } from "./home-page.js";
import { packageRoot } from "./package-root.js";
import { radarVersion } from "./version.js";

/**
 * HTTP 是 Radar 的内部实现，不是契约（ADR 0012）——契约是 `radar` 的命令面。
 * 这些路由只服务本机的 CLI 与那张来源页，可以随 CLI 稳定而改形状。
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

  app.get("/briefs", (context) => context.json(listBriefs()));

  // 每条 /briefs/:briefId/… 都先确认 Brief 存在，处理器里不必各自再查一遍。
  app.use("/briefs/:briefId/*", async (context, next) => {
    if (!getBrief(context.req.param("briefId"))) {
      throw new HTTPException(404, { message: "找不到这个 Radar Brief。" });
    }
    await next();
  });

  app.post("/briefs", async (context) => {
    const body = await jsonBody(context.req.raw);
    const name = requiredText(body.name, "Brief 名称");
    const description = requiredText(body.description, "Brief 正文");
    return context.json(createBrief({ name, description }), 201);
  });

  app.get("/briefs/:briefId/sources", (context) => {
    const briefId = context.req.param("briefId");
    return context.json({
      sources: listBriefSources(briefId),
      available: listAvailableInstanceSources(briefId),
    });
  });

  app.post("/briefs/:briefId/sources", async (context) => {
    const briefId = context.req.param("briefId");
    const body = await jsonBody(context.req.raw);
    if (typeof body.sourceId === "string" && body.sourceId.trim()) {
      return context.json(await domainCall(() => linkSavedSource(briefId, body.sourceId as string)), 201);
    }
    const url = requiredText(body.url, "Feed URL");
    return context.json(await domainCall(() => validateAndLinkSource(briefId, url)), 201);
  });

  app.delete("/briefs/:briefId/sources/:sourceId", async (context) => {
    const briefId = context.req.param("briefId");
    await domainCall(() => stopUsingSource(briefId, context.req.param("sourceId")));
    return context.json({ stopped: true });
  });

  app.post("/briefs/:briefId/sources/:sourceId/collect", async (context) => {
    const briefId = context.req.param("briefId");
    return context.json(await domainCall(() => collectSource(briefId, context.req.param("sourceId"))));
  });

  app.get("/briefs/:briefId/judgments", (context) => {
    const briefId = context.req.param("briefId");
    return context.json({
      pendingContents: listPendingContents(briefId),
      judgments: listJudgments(briefId),
    });
  });

  app.post("/briefs/:briefId/judgments", async (context) => {
    const briefId = context.req.param("briefId");
    const body = await jsonBody(context.req.raw);
    const signalContentIds = Array.isArray(body.signalContentIds)
      ? body.signalContentIds.filter((id): id is string => typeof id === "string")
      : undefined;
    const judgment = await domainCall(() =>
      recordJudgment(briefId, {
        sourceContentId: requiredText(body.sourceContentId, "来源内容 id"),
        relevant: body.relevant === true,
        reason: requiredText(body.reason, "判断理由"),
        signalContentIds,
      }),
    );
    return context.json(judgment, 201);
  });

  app.onError((error, context) => {
    if (error instanceof HTTPException) {
      return context.json({ error: error.message }, error.status);
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

/** 领域层用普通 Error 表达用户可修正的输入问题，到了 HTTP 边界它们是 400。 */
async function domainCall<T>(run: () => T | Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw new HTTPException(400, {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
