#!/usr/bin/env node
import { radarDataDirectory } from "../lib/data-directory.js";
import { DataDirectoryBusyError, defaultPort } from "../lib/service-runtime.js";
import { callRadar, readStdin } from "./client.js";
import { radarVersion } from "../server/version.js";

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
  radar collect [--endpoint <id>] 催一次采集。点名端点会越过失败退避；
                                  不给 --endpoint 就全催一遍，退避照样生效

判断
  radar pending --brief <id> [--limit <n>]
                                  取一个工作包：待判断内容 + Brief 正文
                                  + 全部反馈 + 最近判断的紧凑清单
  radar judge                     写回判断，契约 JSON 从 stdin 读
  radar judgments --brief <id>    列出已写回的判断

反馈
  radar feedback --brief <id> [--judgment <id>] --disposition <标签>
                                  写回用户明说的反馈，正文从 stdin 读

其他
  radar --help / --version

环境变量
  RADAR_DATA_DIR                  本地数据目录，默认 ~/.radar

取数据的命令输出 JSON，直接管给 jq。judge 的契约是：
  { queueEntryId, relevant, whatItIs, evidence, uncertainty, whyForYou,
    judgedBy, signalContentIds?, idempotencyKey? }
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
      case "collect":
        return await collect(rest);
      case "pending":
        return await pending(rest);
      case "judge":
        return emit(await callRadar("/judgments", { method: "POST", body: await readJsonStdin() }));
      case "judgments":
        return emit(await callRadar(`/briefs/${requiredOption(rest, "--brief")}/judgments`));
      case "feedback":
        return await feedback(rest);
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
  process.stdout.write(`[Radar] 来源页：http://127.0.0.1:${service.port}\n`);
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

async function collect(argv: string[]): Promise<void> {
  const endpointId = option(argv, "--endpoint");
  if (endpointId) {
    return emit(
      await callRadar(`/endpoints/${endpointId}/collect?force=true`, { method: "POST" }),
    );
  }
  emit(await callRadar("/collect", { method: "POST" }));
}

async function pending(argv: string[]): Promise<void> {
  const briefId = requiredOption(argv, "--brief");
  const limit = numberOption(argv, "--limit", 1, 1_000);
  const query = limit === undefined ? "" : `?limit=${limit}`;
  emit(await callRadar(`/briefs/${briefId}/work-package${query}`));
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

async function readJsonStdin(): Promise<unknown> {
  const raw = (await readStdin()).trim();
  if (!raw) fail("判断契约从 stdin 读，现在是空的。用 `radar --help` 看契约。");
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
  return argv.flatMap((token, index) => (token === flag && argv[index + 1] ? [argv[index + 1]!] : []));
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
