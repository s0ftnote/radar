import { expect, test } from "@playwright/test";
import { createBriefWithAllSources, startHarness, type Endpoint } from "./support/harness.js";
import { radar, radarJson } from "./support/radar-process.js";

/**
 * 管家角色的完整操作面：用户在对话里随口改主意，这几条命令都接得住。
 */

type Brief = { id: string; currentRevision: { number: number; body: string; rationale: string | null } };
type Revision = { number: number; body: string; rationale: string | null };
type Subject = {
  id: string;
  name: string;
  aliases: string[];
  endpointIds: string[];
  createdAt: string;
};
type WorkPackage = {
  pendingContents: Array<{ endpointId: string; title: string }>;
  queueDepth: number;
};
type BriefDetail = {
  includedEndpoints: Array<{ endpointId: string; name: string; topics: string[] }>;
};

const briefBody = "关注开发者反复表达、正在变化、可能还没被满足的需求与痛点。";

async function createBrief(environment: Parameters<typeof radarJson>[0], name: string): Promise<Brief> {
  return radarJson<Brief>(environment, ["brief", "create", "--name", name], briefBody);
}

test.describe("管家角色的操作面", () => {
  test.describe.configure({ mode: "serial" });

  test("改 Brief 正文形成可追溯的修订，当前版本与历史版本同时保留", async () => {
    test.setTimeout(120_000);
    const harness = await startHarness("revise", 33161);
    const { environment } = harness;
    try {
      const brief = await createBrief(environment, "Demand Radar");
      expect(brief.currentRevision.number).toBe(1);

      const revised = await radarJson<Brief>(
        environment,
        ["brief", "revise", brief.id, "--rationale", "用户说招聘帖也想看一眼行情"],
        "关注开发者的需求与痛点，招聘帖也留着当行情看。",
      );
      expect(revised.currentRevision.number).toBe(2);
      expect(revised.currentRevision.body).toContain("招聘帖也留着");
      expect(revised.currentRevision.rationale).toBe("用户说招聘帖也想看一眼行情");

      // 历史版本不删——改主意要留得下追溯。
      const revisions = await radarJson<Revision[]>(environment, ["brief", "revisions", brief.id]);
      expect(revisions.map((revision) => revision.number)).toEqual([2, 1]);
      expect(revisions[1]!.body).toBe(briefBody);
      expect(revisions[1]!.rationale).toBeNull();

      // 依据必填：随口改主意也要说清为什么。
      const noRationale = await radar(environment, ["brief", "revise", brief.id], "换个说法。");
      expect(noRationale.code).toBe(1);
      expect(noRationale.stderr).toContain("--rationale");
    } finally {
      await harness.dispose();
    }
  });

  test("关注对象住在 Brief 内部，别名与关联端点整体改写", async () => {
    test.setTimeout(120_000);
    const harness = await startHarness("subjects", 33162);
    const { environment } = harness;
    try {
      const brief = await createBrief(environment, "Demand Radar");
      const other = await createBrief(environment, "另一条 Brief");

      const added = await radarJson<Subject>(environment, [
        "subject", "put", "--brief", brief.id,
        "--name", "某位工具作者",
        "--alias", "toolmaker", "--alias", "工具作者",
        "--endpoint", "fixture-alpha",
      ]);
      expect(added.aliases).toEqual(["toolmaker", "工具作者"]);
      expect(added.endpointIds).toEqual(["fixture-alpha"]);

      // 作用域必然是 Brief 级：另一条 Brief 看不见它。
      expect(await radarJson<Subject[]>(environment, ["subject", "list", "--brief", other.id])).toEqual([]);

      // 同名即同一条，别名与端点整体替换而不是累加。
      const updated = await radarJson<Subject>(environment, [
        "subject", "put", "--brief", brief.id,
        "--name", "某位工具作者",
        "--alias", "toolmaker",
        "--endpoint", "fixture-beta",
      ]);
      expect(updated.aliases).toEqual(["toolmaker"]);
      expect(updated.endpointIds).toEqual(["fixture-beta"]);
      expect(await radarJson<Subject[]>(environment, ["subject", "list", "--brief", brief.id])).toHaveLength(1);

      // 改名字不换掉那条书签：id 与创建时间都留着。
      const renamed = await radarJson<Subject>(environment, [
        "subject", "put", "--brief", brief.id,
        "--name", "某位工具作者", "--rename", "那位工具作者",
        "--alias", "toolmaker", "--endpoint", "fixture-beta",
      ]);
      expect(renamed.name).toBe("那位工具作者");
      expect(renamed.id).toBe(added.id);
      expect(renamed.createdAt).toBe(added.createdAt);

      const removed = await radar(environment, [
        "subject", "remove", "--brief", brief.id, "--name", "那位工具作者",
      ]);
      expect(removed.code).toBe(0);
      expect(await radarJson<Subject[]>(environment, ["subject", "list", "--brief", brief.id])).toEqual([]);

      const missing = await radar(environment, [
        "subject", "remove", "--brief", brief.id, "--name", "没这个人",
      ]);
      expect(missing.code).toBe(1);
      expect(missing.stderr).toContain("没有叫");
    } finally {
      await harness.dispose();
    }
  });

  test("用户自己登记的端点标成 user，与出厂端点区分得开", async () => {
    test.setTimeout(120_000);
    const harness = await startHarness("register", 33163);
    const { environment, feed } = harness;
    try {
      feed.replacePage("/gamma", [
        {
          guid: "gamma-1",
          title: "我自己盯的那个源",
          body: "只有我这台机器上有这条源。",
          publishedAt: "Mon, 24 Aug 2026 13:00:00 GMT",
        },
      ]);
      const added = await radarJson<Endpoint>(environment, [
        "sources", "add", "--channel", "rss", "--name", "我自己加的", "--url", `${feed.url}/gamma`,
      ]);
      expect(added.provenance).toBe("user");

      // 登记了不等于在采：一条 Brief 都没纳入它，来源状态就是「未纳入」，
      // `radar sources` 默认不列它，点名催它也不采（#104）。
      expect(added.status).toBe("not_included");
      expect(await radarJson<Endpoint[]>(environment, ["sources"])).toEqual([]);
      expect(
        await radarJson<{ status: string; skippedBecause?: string }>(
          environment, ["collect", "--endpoint", added.id],
        ),
      ).toMatchObject({ status: "skipped", skippedBecause: "not_included" });

      // 升级对账唯一要用的区分：出厂那批与用户加的这条分得开。
      const all = await radarJson<Endpoint[]>(environment, ["sources", "--catalog"]);
      expect(all.filter((endpoint) => endpoint.provenance === "user").map((e) => e.id)).toEqual([added.id]);
      expect(all.filter((endpoint) => endpoint.provenance === "factory")).toHaveLength(2);

      // 纳入一条 Brief 之后 Radar 才去采它。
      const brief = await createBrief(environment, "Demand Radar");
      await radarJson(environment, ["sources", "include", added.id, "--brief", brief.id]);
      await radarJson(environment, ["collect", "--endpoint", added.id]);
      const collected = (await radarJson<Endpoint[]>(environment, ["sources"])).find(
        (endpoint) => endpoint.id === added.id,
      )!;
      expect(collected.status).toBe("normal");

      // 同一个地址不重复登记：换地址是改 url，不是新开一条（ADR 0014）。
      const duplicate = await radar(environment, [
        "sources", "add", "--channel", "rss", "--name", "又加一遍", "--url", `${feed.url}/gamma`,
      ]);
      expect(duplicate.code).toBe(1);
      expect(duplicate.stderr).toContain("已经登记过了");
    } finally {
      await harness.dispose();
    }
  });

  test("新建的 Brief 队列是空的，纳入一条端点之后才收得到它的内容", async () => {
    test.setTimeout(120_000);
    const harness = await startHarness("inclusions", 33166);
    const { environment } = harness;
    try {
      // 另一条 Brief 把两条端点都纳入了，实例因此一直在采它们。
      await createBriefWithAllSources(environment, "另一条线", briefBody);
      const brief = await createBrief(environment, "Demand Radar");

      // 一条端点都没纳入：队列是空的，哪怕实例早就采到了内容——一条 Brief 只看
      // 它纳入的端点（ADR 0018）。
      const empty = await radarJson<WorkPackage>(environment, ["pending", "--brief", brief.id]);
      expect(empty.pendingContents).toEqual([]);
      expect(empty.queueDepth).toBe(0);
      expect(await radarJson(environment, ["queue", "--brief", brief.id])).toMatchObject({
        queueDepth: 0,
      });
      expect(await radarJson<BriefDetail>(environment, ["brief", "show", brief.id]))
        .toMatchObject({ includedEndpoints: [] });

      await radarJson(environment, ["sources", "include", "fixture-alpha", "--brief", brief.id]);

      // 纳入之后，下一次入队就收得到——别的 Brief 纳着它，采集一直在进行。
      await radarJson(environment, ["collect", "--endpoint", "fixture-alpha"]);
      const filled = await radarJson<WorkPackage>(environment, ["pending", "--brief", brief.id]);
      expect(filled.pendingContents.length).toBeGreaterThan(0);
      expect(new Set(filled.pendingContents.map((content) => content.endpointId)))
        .toEqual(new Set(["fixture-alpha"]));

      // 看一条 Brief 就看得见它纳入了哪些端点，topics 一并给出。
      const shown = await radarJson<BriefDetail>(environment, ["brief", "show", brief.id]);
      expect(shown.includedEndpoints).toEqual([
        expect.objectContaining({ endpointId: "fixture-alpha", topics: ["devtools", "systems"] }),
      ]);
    } finally {
      await harness.dispose();
    }
  });

  test("两级开关互不覆盖：实例级停用真的不采，Brief 级纳入只决定这条 Brief 看不看", async () => {
    test.setTimeout(120_000);
    const harness = await startHarness("switches", 33164);
    const { environment, feed } = harness;
    try {
      const brief = await createBrief(environment, "Demand Radar");
      const other = await createBrief(environment, "另一条 Brief");

      // Brief 级纳入：这条 Brief 只纳入 beta，另一条两条都纳入。
      const inclusions = await radarJson<Array<{ endpointId: string; reason: string | null }>>(
        environment,
        ["sources", "include", "fixture-beta", "--brief", brief.id, "--reason", "这条线只看它"],
      );
      expect(inclusions).toHaveLength(1);
      expect(inclusions[0]).toMatchObject({ endpointId: "fixture-beta", reason: "这条线只看它" });
      for (const endpointId of ["fixture-alpha", "fixture-beta"]) {
        await radarJson(environment, ["sources", "include", endpointId, "--brief", other.id]);
      }
      // 纳入之后才有得采：这一催把两条端点的当前一页都取回来（#104）。
      await radarJson(environment, ["collect"]);

      const scoped = await radarJson<WorkPackage>(environment, ["pending", "--brief", brief.id]);
      expect(scoped.pendingContents.map((content) => content.endpointId)).toEqual(["fixture-beta"]);
      const unaffected = await radarJson<WorkPackage>(environment, ["pending", "--brief", other.id]);
      expect(new Set(unaffected.pendingContents.map((c) => c.endpointId))).toEqual(
        new Set(["fixture-alpha", "fixture-beta"]),
      );

      // 没纳入这条 Brief 不是停用：另一条 Brief 纳着 alpha，Radar 照样在采它。
      const stillCollecting = await radarJson<Endpoint[]>(environment, ["sources"]);
      expect(stillCollecting[0]!.userDisabledAt).toBeNull();
      expect(await radarJson<{ status: string }>(
        environment, ["collect", "--endpoint", "fixture-alpha"],
      )).toMatchObject({ status: "success" });

      // 每条端点已被哪些 Brief 纳入，`radar sources` 就答得出。
      const beta = (await radarJson<Endpoint[]>(environment, ["sources"]))
        .find((endpoint) => endpoint.id === "fixture-beta")!;
      expect(beta.includedInBriefs.map((each) => each.briefId).sort())
        .toEqual([brief.id, other.id].sort());

      // 实例级停用：写进的是「用户停用」字段，「目录退役」字段不碰。
      const disabled = await radarJson<Endpoint>(environment, [
        "sources", "disable", "fixture-beta",
      ]);
      expect(disabled.userDisabledAt).not.toBeNull();
      expect(disabled.retiredAt).toBeNull();
      expect(disabled.retiredReason).toBeNull();

      // 停用之后 Radar 真的不再采它。
      expect(await radarJson<{ skippedBecause?: string }>(
        environment, ["collect", "--endpoint", "fixture-beta"],
      )).toMatchObject({ status: "skipped", skippedBecause: "not_collectable" });

      const enabled = await radarJson<Endpoint>(environment, ["sources", "enable", "fixture-beta"]);
      expect(enabled.userDisabledAt).toBeNull();

      // 没纳入那段时间 alpha 出的新内容，纳入之后照样看得见——纳入是「看不看」，
      // 不是「丢掉」（ADR 0010：只排序不丢弃）。
      feed.addEntry({
        guid: "alpha-3",
        title: "纳入之前冒出来的一条",
        body: "这条是在 alpha 还没被纳入的窗口里采到的。",
        publishedAt: "Tue, 25 Aug 2026 09:00:00 GMT",
      });
      await radarJson(environment, ["collect", "--endpoint", "fixture-alpha"]);
      expect(
        (await radarJson<WorkPackage>(environment, ["pending", "--brief", brief.id]))
          .pendingContents.map((content) => content.endpointId),
      ).toEqual(["fixture-beta"]);

      await radarJson(environment, ["sources", "include", "fixture-alpha", "--brief", brief.id]);
      const restored = await radarJson<WorkPackage>(environment, ["pending", "--brief", brief.id]);
      expect(restored.pendingContents.map((content) => content.title)).toContain(
        "纳入之前冒出来的一条",
      );

      // 移出去只是这条 Brief 不再看它，代次一条不删：再纳入回来原样还在。
      await radarJson(environment, ["sources", "remove", "fixture-alpha", "--brief", brief.id]);
      expect(await radarJson<BriefDetail>(environment, ["brief", "show", brief.id]))
        .toMatchObject({ includedEndpoints: [expect.objectContaining({ endpointId: "fixture-beta" })] });
      expect(
        (await radarJson<WorkPackage>(environment, ["pending", "--brief", brief.id]))
          .pendingContents.map((content) => content.endpointId),
      ).toEqual(["fixture-beta"]);
    } finally {
      await harness.dispose();
    }
  });

  test("反馈可以挂在判断上也可以只挂在 Brief 上，处置标签由调用者自定", async () => {
    test.setTimeout(120_000);
    const harness = await startHarness("feedback", 33165);
    const { environment } = harness;
    try {
      const brief = await createBrief(environment, "Demand Radar");

      // Radar 不预设处置标签的可选值，也不解释它。
      const loose = await radarJson<{ judgmentId: string | null; disposition: string }>(
        environment,
        ["feedback", "--brief", brief.id, "--disposition", "这类以后每周只给一条就够"],
        "别一下子推一堆。",
      );
      expect(loose.judgmentId).toBeNull();
      expect(loose.disposition).toBe("这类以后每周只给一条就够");
    } finally {
      await harness.dispose();
    }
  });
});
