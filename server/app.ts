import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import {
  acceptPushedEntries,
  collectAllEndpoints,
  collectEndpoint,
  type PushedEntry,
} from "../lib/acquisition.js";
import {
  createBrief,
  getBrief,
  listBriefRevisions,
  listBriefs,
  reviseBrief,
} from "../lib/briefs.js";
import { radarDataDirectory } from "../lib/data-directory.js";
import {
  listBriefExclusions,
  listEndpoints,
  registerUserEndpoint,
  setBriefExclusion,
  setUserDisabled,
} from "../lib/endpoints.js";
import { listFeedback, recordFeedback } from "../lib/feedback.js";
import {
  listDeliveries,
  markDelivered,
  takeForDelivery,
  unmarkDelivered,
} from "../lib/deliveries.js";
import { discoverCandidates } from "../lib/discovery.js";
import { RadarDomainError } from "../lib/domain-error.js";
import { exportBrief } from "../lib/export.js";
import { rsshubBaseUrl, setRsshubBaseUrl } from "../lib/rsshub.js";
import { listJudgments, recordJudgment } from "../lib/judgments.js";
import {
  enqueueCurrentPage,
  queueStatus,
  requeueContent,
  retentionDays,
  setRetentionDays,
} from "../lib/queue.js";
import {
  currentStrategy,
  listStrategyRevisions,
  putStrategy,
  strategyStats,
} from "../lib/strategy.js";
import {
  listWatchedSubjects,
  putWatchedSubject,
  removeWatchedSubject,
} from "../lib/watched-subjects.js";
import {
  assembleWorkPackage,
  defaultWorkPackageLimit,
  maximumWorkPackageLimit,
} from "../lib/work-package.js";
import { renderHomePage, type DiscoveryPanel } from "./home-page.js";
import { packageRoot } from "../lib/package-root.js";
import { radarVersion } from "../lib/version.js";

/**
 * HTTP 是 Radar 的内部实现，不是契约（ADR 0012）——契约是 `radar` 的命令面。
 * 这些路由只服务本机的 CLI 与那张来源页。
 */
export function createRadarApp(): Hono {
  const app = new Hono();

  /**
   * 服务听在固定端口上，用户浏览器里任何一个页面都够得着它。表单 POST 不触发
   * 预检，跨站直接就能把来源停掉——所以整个 app 都过一遍同源校验。CLI 走
   * `application/json`，浏览器跨站发不出这个 content-type，不受影响。
   */
  app.use(csrf());

  app.get("/health", (context) =>
    context.json({ ok: true, version: radarVersion(), dataDirectory: radarDataDirectory() }),
  );

  app.get("/", (context) => context.html(homePage()));

  // 粘网址加源的三步都在这一页上完成：找候选 → 挑一条 → 加进来。
  app.post("/sources/discover", async (context) => {
    const form = await context.req.formData();
    const pastedUrl = String(form.get("url") ?? "").trim();
    try {
      return context.html(homePage({ pastedUrl, candidates: await discoverCandidates(pastedUrl) }));
    } catch (error) {
      // 页面只说一句结果，细节问 Agent（ADR 0013）。
      const message = error instanceof RadarDomainError ? error.message : "没找到可订阅的 feed。";
      return context.html(homePage({ pastedUrl, message }));
    }
  });

  app.post("/sources/add", async (context) => {
    const form = await context.req.formData();
    registerUserEndpoint({
      channelId: "rss",
      name: String(form.get("name") ?? "").trim() || String(form.get("url") ?? ""),
      url: String(form.get("url") ?? "").trim(),
    });
    return context.redirect("/", 303);
  });

  app.post("/settings/rsshub", async (context) => {
    const form = await context.req.formData();
    const raw = String(form.get("baseUrl") ?? "").trim();
    setRsshubBaseUrl(raw === "" ? null : raw);
    return context.redirect("/", 303);
  });

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

  app.post("/endpoints", async (context) => {
    const body = await jsonBody(context.req.raw);
    return context.json(
      registerUserEndpoint({
        channelId: requiredText(body.channelId, "采集渠道 id"),
        name: requiredText(body.name, "端点名字"),
        url: requiredText(body.url, "端点地址"),
      }),
      201,
    );
  });

  // 实例级停用与 Brief 级排除是两个开关，互不覆盖。
  app.post("/endpoints/:endpointId/enabled", async (context) => {
    const body = await jsonBody(context.req.raw);
    return context.json(setEnabled(context.req.param("endpointId"), body.enabled));
  });

  // 来源页上唯一那个动作，同一个操作换个说法进来。表单提交完把用户送回那一页
  // ——页面是给人看的，不该让浏览器停在一段 JSON 上。
  app.post("/sources/:endpointId/enabled", async (context) => {
    const form = await context.req.formData();
    setEnabled(context.req.param("endpointId"), form.get("enabled") === "true");
    return context.redirect("/", 303);
  });

  // 粘一个网址进来，尽力把它变成一条可订阅的端点。这里只给候选，不落库——
  // 挑中哪条由用户说了算，挑完走普通的登记（ADR 0014）。
  app.post("/discover", async (context) => {
    const body = await jsonBody(context.req.raw);
    return context.json(await discoverCandidates(requiredText(body.url, "网址")));
  });

  // 队列保留窗口，实例级可配、默认 30 天（ADR 0010）。
  app.get("/settings/retention", (context) => context.json({ days: retentionDays() }));

  app.put("/settings/retention", async (context) => {
    const body = await jsonBody(context.req.raw);
    return context.json({ days: setRetentionDays(Number(body.days)) });
  });

  // 你自己那台 RSSHub 的地址。RSSHub 不是采集渠道（ADR 0013）。
  app.get("/settings/rsshub", (context) => context.json({ baseUrl: rsshubBaseUrl() }));

  app.put("/settings/rsshub", async (context) => {
    const body = await jsonBody(context.req.raw);
    const raw = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
    {
      try {
        setRsshubBaseUrl(raw === "" ? null : raw);
      } catch {
        throw new RadarDomainError(`${raw} 不是一个网址。`, 400);
      }
    }
    return context.json({ baseUrl: rsshubBaseUrl() });
  });

  // 需要登录态的平台由用户自己的 Agent 采完推来（ADR 0011）。
  // 契约由领域层把关，这里不重复校验一遍。
  app.post("/endpoints/:endpointId/push", async (context) => {
    const body = await jsonBody(context.req.raw);
    const entries = Array.isArray(body.entries) ? (body.entries as PushedEntry[]) : [];
    return context.json(acceptPushedEntries(context.req.param("endpointId"), entries), 201);
  });

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

  app.get("/briefs/:briefId/work-package", (context) =>
    context.json(
      assembleWorkPackage(context.req.param("briefId"), limitOf(context.req.query("limit"))),
    ),
  );

  app.post("/briefs/:briefId/revisions", async (context) => {
    const body = await jsonBody(context.req.raw);
    return context.json(
      reviseBrief({
        briefId: context.req.param("briefId"),
        body: requiredText(body.body, "Brief 正文"),
        rationale: requiredText(body.rationale, "改动依据"),
      }),
      201,
    );
  });

  // 完整导出只读，不改动任何数据（ADR 0008）。
  app.get("/briefs/:briefId/export", (context) =>
    context.json(exportBrief(context.req.param("briefId"), radarVersion())),
  );

  // 取数角色要的两个机械事实：队列还有多深、最近一次判断是什么时候（#44）。
  app.get("/briefs/:briefId/queue", (context) =>
    context.json(queueStatus(context.req.param("briefId"))),
  );

  // 显式回捞：判过的、或过了保留窗口被移出去的，开一个新的代次重判。
  app.post("/briefs/:briefId/queue/requeue", async (context) => {
    const body = await jsonBody(context.req.raw);
    return context.json(
      requeueContent(context.req.param("briefId"), requiredText(body.sourceContentId, "内容 id")),
      201,
    );
  });

  app.get("/briefs/:briefId/revisions", (context) =>
    context.json(listBriefRevisions(context.req.param("briefId"))),
  );

  app.get("/briefs/:briefId/subjects", (context) =>
    context.json(listWatchedSubjects(context.req.param("briefId"))),
  );

  app.put("/briefs/:briefId/subjects", async (context) => {
    const body = await jsonBody(context.req.raw);
    return context.json(
      putWatchedSubject({
        briefId: context.req.param("briefId"),
        name: requiredText(body.name, "关注对象的名字"),
        renameTo: typeof body.renameTo === "string" ? body.renameTo : undefined,
        aliases: textList(body.aliases),
        endpointIds: textList(body.endpointIds),
      }),
    );
  });

  app.delete("/briefs/:briefId/subjects/:name", (context) => {
    removeWatchedSubject(
      context.req.param("briefId"),
      decodeURIComponent(context.req.param("name")),
    );
    return context.body(null, 204);
  });

  app.get("/briefs/:briefId/exclusions", (context) =>
    context.json(listBriefExclusions(context.req.param("briefId"))),
  );

  app.post("/briefs/:briefId/exclusions", async (context) => {
    const body = await jsonBody(context.req.raw);
    setBriefExclusion(
      context.req.param("briefId"),
      requiredText(body.endpointId, "采集端点 id"),
      body.excluded !== false,
      typeof body.reason === "string" ? body.reason : undefined,
    );
    return context.json(listBriefExclusions(context.req.param("briefId")));
  });

  // 策略是独立对象、独立版本化，不塞进 Brief。
  app.get("/briefs/:briefId/strategy", (context) =>
    context.json(currentStrategy(context.req.param("briefId"))),
  );

  app.put("/briefs/:briefId/strategy", async (context) => {
    const body = await jsonBody(context.req.raw);
    return context.json(
      putStrategy({
        briefId: context.req.param("briefId"),
        formula: body.formula,
        rationale: requiredText(body.rationale, "策略修订的依据"),
        authoredBy: requiredText(body.authoredBy, "策略的作者"),
      }),
      201,
    );
  });

  app.get("/briefs/:briefId/strategy/revisions", (context) =>
    context.json(listStrategyRevisions(context.req.param("briefId"))),
  );

  app.get("/briefs/:briefId/strategy/stats", (context) =>
    context.json(strategyStats(context.req.param("briefId"))),
  );

  // 取数角色：取还没送到某个去处的判断，送完显式标记。
  app.get("/briefs/:briefId/deliveries/:destination/pending", (context) => {
    return context.json(
      takeForDelivery({
        briefId: context.req.param("briefId"),
        destination: destinationOf(context.req.param("destination")),
        since: context.req.query("since"),
        until: context.req.query("until"),
        relatedTo: context.req.query("relatedTo"),
        subject: context.req.query("subject"),
        limit: limitOf(context.req.query("limit")),
      }),
    );
  });

  app.get("/briefs/:briefId/deliveries", (context) =>
    context.json(listDeliveries(context.req.param("briefId"), context.req.query("destination"))),
  );

  app.post("/briefs/:briefId/deliveries", async (context) => {
    const body = await jsonBody(context.req.raw);
    return context.json(
      markDelivered({
        briefId: context.req.param("briefId"),
        judgmentId: requiredText(body.judgmentId, "判断 id"),
        destination: requiredText(body.destination, "交付去处"),
        externalReference:
          typeof body.externalReference === "string" ? body.externalReference : undefined,
      }),
      201,
    );
  });

  app.delete("/briefs/:briefId/deliveries/:destination/:judgmentId", (context) => {
    unmarkDelivered(
      context.req.param("briefId"),
      context.req.param("judgmentId"),
      destinationOf(context.req.param("destination")),
    );
    return context.body(null, 204);
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
    const judgment = recordJudgment({
      queueEntryId: requiredText(body.queueEntryId, "队列代次 id"),
      relevant,
      whatItIs: relevant ? requiredText(body.whatItIs, "「是什么」") : undefined,
      evidence: relevant ? requiredText(body.evidence, "「凭什么」") : undefined,
      uncertainty: relevant ? requiredText(body.uncertainty, "「哪里不确定」") : undefined,
      whyForYou: requiredText(body.whyForYou, relevant ? "「为什么给你」" : "淘汰理由"),
      judgedBy: requiredText(body.judgedBy, "判断者"),
      signalContentIds: textList(body.signalContentIds),
      relatedJudgmentIds: textList(body.relatedJudgmentIds),
      idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined,
    });
    return context.json(judgment, 201);
  });

  app.onError((error, context) => {
    if (error instanceof HTTPException) return context.json({ error: error.message }, error.status);
    if (error instanceof RadarDomainError) {
      return context.json({ error: error.message }, error.httpStatus);
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

/**
 * 路径里的交付去处。Hono 已经把它解码过了，这里只再修一次边——写进去时
 * `requiredText` 会 trim，取出来也得一样，否则「 周报」标进去、取不出来。
 */
function destinationOf(raw: string): string {
  return requiredText(raw, "交付去处");
}

function homePage(discovery?: DiscoveryPanel) {
  return renderHomePage({
    version: radarVersion(),
    dataDirectory: radarDataDirectory(),
    endpoints: listEndpoints(),
    rsshubBaseUrl: rsshubBaseUrl(),
    discovery,
  });
}

/** 开关只有开和关两种写法，两个入口写的是同一份 Radar 状态。 */
function setEnabled(endpointId: string, enabled: unknown) {
  return setUserDisabled(endpointId, enabled !== true);
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
/** 一次给多少条由服务端说了算：客户端要不到无限长的一包，也不能要半条。 */
function limitOf(raw: string | undefined): number {
  const requested = Number(raw ?? defaultWorkPackageLimit);
  if (!Number.isInteger(requested) || requested < 1) {
    throw new HTTPException(400, { message: "`limit` 需要一个正整数。" });
  }
  return Math.min(requested, maximumWorkPackageLimit);
}
