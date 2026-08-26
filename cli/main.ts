#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { radarDataDirectory } from "../lib/data-directory.js";
import type { BriefExport } from "../lib/export.js";
import { DataDirectoryBusyError, defaultPort } from "../lib/service-runtime.js";
import { callRadar, readStdin } from "./client.js";
import { defaultSkillsTarget, installSkills } from "./skills.js";
import { radarVersion } from "../lib/version.js";

const usage = `radar — 本地信号聚合站

服务
  radar up [--port <端口>]        在本机起 Radar 服务，Ctrl-C 停止
  radar status                    看本机 Radar 服务的状态

Brief
  radar brief create --name <名字>
                                  建 Brief，正文从 stdin 读
  radar brief list                列出所有 Brief
  radar brief show <briefId>      看一个 Brief 的当前修订
  radar brief revise <briefId> --rationale <依据>
                                  改正文，形成新修订，正文从 stdin 读
  radar brief revisions <briefId> 列出全部修订，历史版本一并保留

关注对象（住在 Brief 内部）
  radar subject put --brief <id> --name <名字> [--rename <新名字>]
                    [--alias <别名>…] [--endpoint <id>…]
                                  新增或改写。别名只供机械匹配，Radar 不核对身份；
                                  --rename 改名字而不换掉那条书签
  radar subject list --brief <id>
  radar subject remove --brief <id> --name <名字>

采集
  radar sources                   列出采集端点与来源状态
  radar sources add --channel <id> --name <名字> --url <地址>
                                  登记自己的端点，标成 user 来源
  radar sources disable|enable <endpointId>
                                  实例级：Radar 真的不再采它 / 恢复采集
  radar sources exclude|include <endpointId> --brief <id> [--reason <理由>]
                                  Brief 级：只是这个 Brief 不看它，其他 Brief 照采
  radar sources exclusions --brief <id>
  radar push --endpoint <id>      Agent 把采来的内容推给这个端点，JSON 从 stdin 读：
                                  [{ externalId, title, originUrl, body, publishedAt? }, …]
                                  端点须在「配置后解锁」渠道下，Radar 不自采它
                                  必须带正文——只推地址不算完整的推送
  radar discover <网址>            粘一个网址，尽力把它变成可订阅的端点。依次
                                  试 RSSHub 规则、页面自带的 feed、约定路径
                                  （/feed、/rss.xml 那几个）、认得该域名的适配器
                                  （GitHub、YouTube、V2EX、Substack、Medium、
                                  Reddit）；都不中就明说够不着，不去抓 HTML。
                                  可能给出多条候选，挑一条 sources add 进来。
                                  标着 needs=rsshub 的那种，得先有一台 RSSHub
  radar rsshub set <地址>          你自己那台 RSSHub 的地址。没填也照样列出匹配
                                  到的路由，只是订阅不了——Radar 不替你找一台
                                  公共实例。自己起一台：
                                  docker run -d --name rsshub -p 1200:1200 diygod/rsshub
                                  规则每天从你那台刷新，只在粘网址那一刻用一次
  radar rsshub show | clear
  radar collect [--endpoint <id>] 催一次采集。点名端点会越过失败退避；
                                  不给 --endpoint 就全催一遍，退避与渠道节奏
                                  照样生效，整趟 60 秒封顶

排队策略（独立对象，不塞进 Brief）
  radar strategy set --brief <id> --rationale <依据> --by <作者>
                                  下发打分公式，JSON 从 stdin 读：
                                  { freshnessHalfLifeHours, freshnessWeight,
                                    endpointWeights, keywords: [{term, weight}],
                                    hotnessWeight, hitRateWeight }
                                  关键词只能加减分，不能用于排除
  radar strategy show --brief <id>
  radar strategy revisions --brief <id>
  radar strategy stats --brief <id>
                                  每个端点与每条信号的命中统计，纯计数

判断
  radar pending --brief <id> [--limit <n>]
                                  取一个工作包：待判断内容 + Brief 正文
                                  + 全部反馈 + 最近判断的紧凑清单
  radar judge                     写回判断，契约 JSON 从 stdin 读
  radar judgments --brief <id>    列出已写回的判断
  radar queue --brief <id>        队列还有多深、最近一次判断是什么时候。
                                  两个机械事实，不含判断
  radar requeue --brief <id> --content <sourceContentId>
                                  显式回捞：给这条内容开一个新的队列代次。
                                  判过的重判、过了保留窗口被移出去的捞回来，
                                  走的都是这一条
  radar retention [--days <n>]    队列保留窗口，默认 30 天。超过窗口仍没判断的
                                  内容移出待判断队列，但不删除，随时能回捞

交付
  radar deliver take --brief <id> --to <去处> [--since <ISO>] [--until <ISO>]
                     [--related-to <judgmentId>] [--subject <名字>] [--limit <n>]
                                  取还没送到这个去处的判断。去处是你自己起的
                                  标签，Radar 不预设也不校验。只给相关的判断，
                                  淘汰掉的不是输出材料
                                  --related-to 顺着关联链取材，链上已经送过的
                                  也一并给出——「这件事上次是怎么写的」问的就是它
                                  --subject 按关注对象的名字或别名机械匹配
  radar deliver mark --brief <id> --to <去处> --judgment <id> [--ref <外部引用>]
                                  显式标记已送到。读到不算送到；同一判断送去
                                  多个去处各记各的。--ref 是你自己的引用
                                  （Obsidian 路径、note id），Radar 只保证它还在
  radar deliver unmark --brief <id> --to <去处> --judgment <id>
                                  账实不符时把账改回来，那条又回到增量里
  radar deliver history --brief <id> [--to <去处>]

反馈
  radar feedback --brief <id> [--judgment <id>] --disposition <标签>
                                  写回用户明说的反馈，正文从 stdin 读

导出
  radar export [--brief <id>] [--dir <目录>]
                                  完整导出：一份可机读的 export.json 加一份
                                  直接读的 README.md。不点名 Brief 就全导出，
                                  每个一个自成一体的子目录。单个 Brief 的档案
                                  不依赖其他 Brief，也不需要 Radar 还活着。
                                  凭据是本地 secret，不进导出

Skill
  radar skills install [--dir <目录>]
                                  把随本版 Radar 来的三份 Skill 装进你的 Agent，
                                  默认 ~/.agents/skills，幂等覆盖。也可以
                                  npx skills add s0ftnote/radar

其他
  radar --help / --version

环境变量
  RADAR_DATA_DIR                  本地数据目录，默认 ~/.radar

取数据的命令输出 JSON，直接管给 jq。judge 的契约是：
  { queueEntryId, relevant, whatItIs, evidence, uncertainty, whyForYou,
    judgedBy, signalContentIds?, relatedJudgmentIds?, idempotencyKey? }
判不相关时前三块留空，whyForYou 写淘汰理由——照样必填。
`;

await main(process.argv.slice(2));

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;

  if (!command || command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(usage);
    return;
  }
  if (command === "--version" || command === "-v") {
    process.stdout.write(`${radarVersion()}\n`);
    return;
  }

  try {
    switch (command) {
      case "up":
        return await up(rest);
      case "status":
        return await status();
      case "brief":
        return await brief(rest);
      case "sources":
        return await sources(rest);
      case "subject":
        return await subject(rest);
      case "push":
        return await push(rest);
      case "collect":
        return await collect(rest);
      case "strategy":
        return await strategy(rest);
      case "pending":
        return await pending(rest);
      case "queue":
        return emit(await callRadar(`/briefs/${requiredOption(rest, "--brief")}/queue`));
      case "requeue":
        return emit(
          await callRadar(`/briefs/${requiredOption(rest, "--brief")}/queue/requeue`, {
            method: "POST",
            body: { sourceContentId: requiredOption(rest, "--content") },
          }),
        );
      case "retention":
        return await retention(rest);
      case "judge":
        return emit(await callRadar("/judgments", { method: "POST", body: await readJsonStdin() }));
      case "judgments":
        return emit(await callRadar(`/briefs/${requiredOption(rest, "--brief")}/judgments`));
      case "deliver":
        return await deliver(rest);
      case "feedback":
        return await feedback(rest);
      case "export":
        return await exportBrief(rest);
      case "skills":
        return skills(rest);
      case "discover":
        return discovered(
          await callRadar("/discover", {
            method: "POST",
            body: { url: positional(rest, "网址") },
          }),
        );
      case "rsshub":
        return await rsshub(rest);
      default:
        fail(`不认识的命令 \`${command}\`。用 \`radar --help\` 看命令面。`);
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

async function up(argv: string[]): Promise<void> {
  const port = numberOption(argv, "--port", 0, 65_535) ?? defaultPort;
  // 只有 `radar up` 需要服务端模块——它一加载就打开 SQLite，别的命令不该碰。
  const { startRadarService } = await import("../server/service.js");
  let service;
  try {
    service = await startRadarService({ port });
  } catch (error) {
    if (error instanceof DataDirectoryBusyError) fail(error.message);
    throw error;
  }

  process.stdout.write(`[Radar] 本地数据目录：${radarDataDirectory()}\n`);
  process.stdout.write(`[Radar] 打开 http://127.0.0.1:${service.port}\n`);
  process.stdout.write("[Radar] Ctrl-C 停止。\n");

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      process.stdout.write(`\n[Radar] 收到 ${signal}，正在停止…\n`);
      void service.stop().then(() => process.exit(0));
    });
  }
}

async function status(): Promise<void> {
  const health = (await callRadar("/health")) as { version: string; dataDirectory: string };
  process.stdout.write(`Radar ${health.version} 正在运行，数据目录 ${health.dataDirectory}\n`);
}

async function brief(argv: string[]): Promise<void> {
  const [subcommand, ...rest] = argv;
  if (subcommand === "create") {
    const name = requiredOption(rest, "--name");
    const body = (await readStdin()).trim();
    if (!body) fail("Brief 正文从 stdin 读，现在是空的。");
    return emit(await callRadar("/briefs", { method: "POST", body: { name, body } }));
  }
  if (subcommand === "list") return emit(await callRadar("/briefs"));
  if (subcommand === "show") {
    return emit(await callRadar(`/briefs/${positional(rest, "briefId")}`));
  }
  if (subcommand === "revise") {
    const briefId = positional(rest, "briefId");
    const rationale = requiredOption(rest, "--rationale");
    const body = (await readStdin()).trim();
    if (!body) fail("Brief 正文从 stdin 读，现在是空的。");
    return emit(
      await callRadar(`/briefs/${briefId}/revisions`, {
        method: "POST",
        body: { body, rationale },
      }),
    );
  }
  if (subcommand === "revisions") {
    return emit(await callRadar(`/briefs/${positional(rest, "briefId")}/revisions`));
  }
  fail("`radar brief` 的子命令是 create / list / show / revise / revisions。");
}

async function sources(argv: string[]): Promise<void> {
  const [subcommand, ...rest] = argv;
  if (!subcommand) return emit(await callRadar("/endpoints"));

  if (subcommand === "add") {
    return emit(
      await callRadar("/endpoints", {
        method: "POST",
        body: {
          channelId: requiredOption(rest, "--channel"),
          name: requiredOption(rest, "--name"),
          url: requiredOption(rest, "--url"),
        },
      }),
    );
  }
  // 实例级：Radar 真的不再采它。跟 Brief 级排除是两个开关。
  if (subcommand === "disable" || subcommand === "enable") {
    return emit(
      await callRadar(`/endpoints/${positional(rest, "endpointId")}/enabled`, {
        method: "POST",
        body: { enabled: subcommand === "enable" },
      }),
    );
  }
  // Brief 级：只是这个 Brief 不看它，其他 Brief 照采。
  if (subcommand === "exclude" || subcommand === "include") {
    const briefId = requiredOption(rest, "--brief");
    const reason = option(rest, "--reason");
    return emit(
      await callRadar(`/briefs/${briefId}/exclusions`, {
        method: "POST",
        body: {
          endpointId: positional(rest, "endpointId"),
          excluded: subcommand === "exclude",
          reason,
        },
      }),
    );
  }
  if (subcommand === "exclusions") {
    return emit(await callRadar(`/briefs/${requiredOption(rest, "--brief")}/exclusions`));
  }
  fail("`radar sources` 的子命令是 add / disable / enable / exclude / include / exclusions。");
}

async function subject(argv: string[]): Promise<void> {
  const [subcommand, ...rest] = argv;
  if (subcommand !== "put" && subcommand !== "list" && subcommand !== "remove") {
    fail("`radar subject` 的子命令是 put / list / remove。");
  }
  const briefId = requiredOption(rest, "--brief");

  if (subcommand === "list") return emit(await callRadar(`/briefs/${briefId}/subjects`));
  if (subcommand === "put") {
    return emit(
      await callRadar(`/briefs/${briefId}/subjects`, {
        method: "PUT",
        body: {
          name: requiredOption(rest, "--name"),
          renameTo: option(rest, "--rename"),
          aliases: listOption(rest, "--alias"),
          endpointIds: listOption(rest, "--endpoint"),
        },
      }),
    );
  }
  if (subcommand === "remove") {
    const name = encodeURIComponent(requiredOption(rest, "--name"));
    await callRadar(`/briefs/${briefId}/subjects/${name}`, { method: "DELETE" });
    return;
  }
}

/**
 * 需要登录态的平台 Radar 够不着：Agent 用自己的采集工具采完推给 Radar。
 * Radar 里不出现任何登录态凭据——推来的只有内容。
 */
async function push(argv: string[]): Promise<void> {
  const endpointId = requiredOption(argv, "--endpoint");
  const entries = await readJsonStdin();
  if (!Array.isArray(entries)) fail("`radar push` 的 stdin 是一个 JSON 数组。");
  emit(
    await callRadar(`/endpoints/${endpointId}/push`, {
      method: "POST",
      body: { entries },
    }),
  );
}

async function collect(argv: string[]): Promise<void> {
  const endpointId = option(argv, "--endpoint");
  if (endpointId) {
    return emit(await callRadar(`/endpoints/${endpointId}/collect?force=true`, { method: "POST" }));
  }
  emit(await callRadar("/collect", { method: "POST" }));
}

/**
 * 排队策略是独立对象、独立版本化，不塞进 Brief——Brief 只有用户明确修正才能
 * 改变。Agent 改策略改的是顺序，不是判断标准。
 */
async function strategy(argv: string[]): Promise<void> {
  const [subcommand, ...rest] = argv;
  if (
    subcommand !== "set" &&
    subcommand !== "show" &&
    subcommand !== "revisions" &&
    subcommand !== "stats"
  ) {
    fail("`radar strategy` 的子命令是 set / show / revisions / stats。");
  }
  const briefId = requiredOption(rest, "--brief");

  if (subcommand === "show") return emit(await callRadar(`/briefs/${briefId}/strategy`));
  if (subcommand === "revisions") {
    return emit(await callRadar(`/briefs/${briefId}/strategy/revisions`));
  }
  if (subcommand === "stats") return emit(await callRadar(`/briefs/${briefId}/strategy/stats`));

  emit(
    await callRadar(`/briefs/${briefId}/strategy`, {
      method: "PUT",
      body: {
        formula: await readJsonStdin(),
        rationale: requiredOption(rest, "--rationale"),
        authoredBy: requiredOption(rest, "--by"),
      },
    }),
  );
}

/** 不给 --days 就是问一句现在是多少天。 */
async function retention(argv: string[]): Promise<void> {
  const days = numberOption(argv, "--days", 1, 3_650);
  if (days === undefined) return emit(await callRadar("/settings/retention"));
  emit(await callRadar("/settings/retention", { method: "PUT", body: { days } }));
}

async function pending(argv: string[]): Promise<void> {
  const briefId = requiredOption(argv, "--brief");
  const limit = numberOption(argv, "--limit", 1, 1_000);
  const query = limit === undefined ? "" : `?limit=${limit}`;
  emit(await callRadar(`/briefs/${briefId}/work-package${query}`));
}

/**
 * 取数角色：问 Radar 要「这个去处还没送过的判断」，送完显式标记。
 * 读到不算送到——跨系统没法原子提交，所以是至少一次交付，账实不符时
 * `radar deliver unmark` 自己把账改回来。
 */
/** 去处是用户自己起的标签，可能带斜杠或空格，进 URL 路径前必须编码。 */
function destinationSegment(argv: string[]): string {
  return encodeURIComponent(requiredOption(argv, "--to"));
}

/**
 * 唯一那处实例级设置：你的 RSSHub 地址。不填就跳过 RSSHub 那一步匹配——
 * Radar 不替你找一台公共实例。
 */
/**
 * 候选照常是 stdout 上那段 JSON（Agent 读的就是它）。规则匹上了但用户还没有
 * 一台 RSSHub 的，另在 stderr 上说一句——不然那条候选的 `feedUrl` 是一段路由，
 * 用户会以为 Radar 给了个坏地址。
 */
function discovered(payload: unknown): void {
  emit(payload);
  const needingRsshub = Array.isArray(payload)
    ? payload.filter((candidate) => (candidate as { needs?: string }).needs === "rsshub")
    : [];
  if (needingRsshub.length === 0) return;
  process.stderr.write(
    `其中 ${needingRsshub.length} 条需要一台 RSSHub 实例：给的是路由不是地址，` +
      "`radar rsshub set <地址>` 填上你自己那台再来一次。" +
      "自己起一台：docker run -d --name rsshub -p 1200:1200 diygod/rsshub\n",
  );
}

async function rsshub(argv: string[]): Promise<void> {
  const [subcommand, ...rest] = argv;
  if (subcommand === "show") return emit(await callRadar("/settings/rsshub"));
  if (subcommand === "set") {
    return emit(
      await callRadar("/settings/rsshub", {
        method: "PUT",
        body: { baseUrl: positional(rest, "RSSHub 地址") },
      }),
    );
  }
  if (subcommand === "clear") {
    return emit(await callRadar("/settings/rsshub", { method: "PUT", body: { baseUrl: "" } }));
  }
  fail("`radar rsshub` 的子命令是 set / show / clear。");
}

/**
 * 把随本版 Radar 来的三份 Skill 装进用户的 Agent。装完用户就只跟 Agent 说话，
 * 不用再直接跟 `radar` 打交道（ADR 0012）。
 */
function skills(argv: string[]): void {
  const [subcommand, ...rest] = argv;
  if (subcommand !== "install") fail("`radar skills` 的子命令是 install。");

  const target = option(rest, "--dir") ?? defaultSkillsTarget();
  const installed = installSkills(target);
  process.stdout.write(`装好 ${installed.length} 份 Skill 到 ${target}：\n`);
  for (const name of installed) process.stdout.write(`  ${name}\n`);
}

async function deliver(argv: string[]): Promise<void> {
  const [subcommand, ...rest] = argv;
  const briefId = requiredOption(rest, "--brief");
  const base = `/briefs/${briefId}/deliveries`;

  if (subcommand === "history") {
    const destination = option(rest, "--to");
    const query = destination ? `?destination=${encodeURIComponent(destination)}` : "";
    return emit(await callRadar(`${base}${query}`));
  }

  if (subcommand === "take") {
    const query = new URLSearchParams();
    for (const [flag, key] of [
      ["--since", "since"],
      ["--until", "until"],
      ["--related-to", "relatedTo"],
      ["--subject", "subject"],
      ["--limit", "limit"],
    ] as const) {
      const value = option(rest, flag);
      if (value) query.set(key, value);
    }
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    return emit(await callRadar(`${base}/${destinationSegment(rest)}/pending${suffix}`));
  }

  if (subcommand === "unmark") {
    const judgmentId = requiredOption(rest, "--judgment");
    await callRadar(`${base}/${destinationSegment(rest)}/${judgmentId}`, { method: "DELETE" });
    return;
  }

  if (subcommand !== "mark") {
    fail("`radar deliver` 的子命令是 take / mark / unmark / history。");
  }

  emit(
    await callRadar(base, {
      method: "POST",
      body: {
        judgmentId: requiredOption(rest, "--judgment"),
        destination: requiredOption(rest, "--to"),
        externalReference: option(rest, "--ref"),
      },
    }),
  );
}

async function feedback(argv: string[]): Promise<void> {
  const briefId = requiredOption(argv, "--brief");
  const disposition = requiredOption(argv, "--disposition");
  const note = (await readStdin()).trim();
  if (!note) fail("反馈正文从 stdin 读，现在是空的。");
  emit(
    await callRadar(`/briefs/${briefId}/feedback`, {
      method: "POST",
      body: { judgmentId: option(argv, "--judgment") ?? null, disposition, note },
    }),
  );
}

/**
 * 完整导出落成两个文件：一份可机读的 JSON，一份不装任何东西就能读的
 * Markdown。单个 Brief 的档案脱离其他 Brief、脱离运行中的实例照样读得完
 * （ADR 0007）。凭据是本地 secret，不在里面（ADR 0008）。
 */
async function exportBrief(argv: string[]): Promise<void> {
  const requested = option(argv, "--brief");
  // 不点名就是「把东西全带走」：每个 Brief 一个自成一体的子目录。
  const briefIds = requested
    ? [requested]
    : ((await callRadar("/briefs")) as Array<{ id: string }>).map((brief) => brief.id);
  const root = resolve(
    option(argv, "--dir") ?? `radar-export-${briefIds.length === 1 ? briefIds[0] : "all"}`,
  );

  const written = [];
  for (const briefId of briefIds) {
    const exported = (await callRadar(`/briefs/${briefId}/export`)) as BriefExport;
    const directory = briefIds.length === 1 ? root : resolve(root, briefId);
    mkdirSync(directory, { recursive: true });
    const files = {
      machineReadable: resolve(directory, "export.json"),
      readable: resolve(directory, "README.md"),
    };
    writeFileSync(files.machineReadable, `${JSON.stringify(exported.archive, null, 2)}\n`);
    writeFileSync(files.readable, exported.readable);
    written.push({ brief: exported.archive.brief.name, directory, ...files });
  }
  emit(written);
}

async function readJsonStdin(): Promise<unknown> {
  const raw = (await readStdin()).trim();
  if (!raw) fail("契约 JSON 从 stdin 读，现在是空的。用 `radar --help` 看契约。");
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    return fail(`stdin 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`);
  }
}

function emit(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function option(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

function requiredOption(argv: string[], flag: string): string {
  const value = option(argv, flag);
  if (!value) fail(`缺少 \`${flag}\`。`);
  return value;
}

/** 子命令的位置参数只有一个，永远排在子命令后面：`brief show <briefId>`。 */
function positional(argv: string[], label: string): string {
  const value = argv[0];
  if (!value || value.startsWith("--")) fail(`这条命令需要一个 ${label}。`);
  return value!;
}

/** 同一个选项给几次就收几个值：`--alias 甲 --alias 乙`。 */
function listOption(argv: string[], flag: string): string[] {
  return argv.flatMap((token, index) =>
    token === flag && argv[index + 1] ? [argv[index + 1]!] : [],
  );
}

function numberOption(
  argv: string[],
  flag: string,
  minimum: number,
  maximum: number,
): number | undefined {
  const raw = option(argv, flag);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    fail(`\`${flag}\` 需要一个 ${minimum}–${maximum} 的整数。`);
  }
  return value;
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
