import { createHash } from "node:crypto";
import type { ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, type BrowserContext } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { startFeedFixture, type FeedFixture } from "./support/feed-fixture";
import { startRadar, stopRadar } from "./support/radar-process";
import { startReportAgentFixture, type ReportAgentFixture } from "./support/report-agent-fixture";

test.setTimeout(90_000);

test("干净会话可以跑通并重启恢复 Radar walking skeleton", async ({ browser }) => {
  let dataDirectory: string | null = null;
  let extractedDirectory: string | null = null;
  let feed: FeedFixture | null = null;
  let agent: ReportAgentFixture | null = null;
  let radar: ChildProcess | null = null;
  let context: BrowserContext | null = null;

  try {
    dataDirectory = await mkdtemp(join(tmpdir(), "radar-walking-skeleton-"));
    extractedDirectory = await mkdtemp(join(tmpdir(), "radar-walking-skeleton-package-"));
    feed = await startFeedFixture();
    agent = await startReportAgentFixture();
    radar = await startRadar(dataDirectory, 33123, {
      RADAR_AGENT_ENDPOINT: agent.endpoint,
      RADAR_AGENT_TOKEN: agent.token,
    });
    context = await browser.newContext({ acceptDownloads: true });
    let page = await context.newPage();
    await page.goto("/");
    await expect(page.getByText("还没有 Radar Project")).toBeVisible();
    await page.getByLabel("Project 名称").fill("Walking Skeleton 验收");
    await page.getByLabel("Radar Brief").fill("寻找需要本地保管、逐层追溯并离线交付证据的明确需求。");

    await context.setOffline(true);
    await page.getByRole("button", { name: "创建 Radar Project" }).click();
    await expect(page.getByText("Radar 暂时无法连接，Project 没有保存，请重试。")).toBeVisible();
    await context.setOffline(false);

    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 750,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await page.getByRole("button", { name: "创建 Radar Project" }).click();
    await expect(page.locator(".create-project form")).toHaveAttribute("aria-busy", "true");
    await expect(page.getByText("正在保存 Radar Project…")).toBeVisible();
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await page.getByRole("link", { name: /Walking Skeleton 验收/ }).click();
    const projectUrl = page.url();

    await expect(page.getByText("还没有来源")).toBeVisible();
    await expect(page.getByText("还没有可判断的来源版本")).toBeVisible();
    await expect(page.getByText("还没有 Report")).toBeVisible();
    await expect(page.getByText("还没有 HTML 物料包")).toBeVisible();

    feed.delayNextResponse();
    await page.getByLabel("公开 RSS/Atom URL").fill(`${feed.url}/feed`);
    await page.getByRole("button", { name: "验证并保存" }).click();
    await expect(page.getByRole("button", { name: "正在验证…" })).toBeDisabled();
    await expect(page.getByRole("heading", { name: "Radar Fixture Feed" })).toBeVisible();

    feed.delayNextResponse();
    await page.getByRole("button", { name: "采集 Radar Fixture Feed" }).click();
    await expect(page.getByRole("button", { name: "正在采集…" })).toBeDisabled();
    await expect(page.locator(".network-notice")).toHaveText("本次新增 1 个来源版本");
    await expect(page.getByText("版本 1", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "运行 Radar 判断" }).click();
    await expect(page.getByRole("button", { name: "正在判断…" })).toBeDisabled();
    const intelligenceItem = page.locator("article.intelligence-item").filter({
      has: page.getByRole("heading", { name: "可报告的本地证据需求" }),
    });
    await expect(intelligenceItem).toBeVisible();
    await expect(intelligenceItem.getByRole("blockquote")).toHaveText(
      "Revision 1: developers want evidence they can keep.",
    );
    for (const label of ["Signal", "Source Network 来源", "来源内容", "来源版本", "Radar Brief 修订"]) {
      await expect(intelligenceItem.getByText(label, { exact: true })).toBeVisible();
    }

    await page.getByLabel("选择 可报告的本地证据需求 修订 1").check();
    await page.getByLabel("内容目的").fill("证明 walking skeleton 可离线交付");
    await page.getByLabel("目标受众").fill("Radar 贡献者");
    await page.getByLabel("核心角度").fill("从固定证据链生成可携带结果");
    await page.getByRole("button", { name: "生成 Report" }).click();
    await expect(page.getByRole("button", { name: "正在生成 Report…" })).toBeDisabled();

    const report = page.locator("article.report-record").filter({
      has: page.getByRole("heading", { name: "证明 walking skeleton 可离线交付 · 固定快照" }),
    });
    await expect(report).toBeVisible();
    await expect(report.getByText(/^Report 身份/)).toBeVisible();
    await expect(report.getByRole("link", { name: "Signal 证据" })).toBeVisible();
    const materialPackage = page.locator("article.material-package-record").first();
    await expect(materialPackage.getByText(/^物料包身份/)).toBeVisible();
    await expect(page.locator("li.material-package-run").getByText("已生成", { exact: true })).toBeVisible();

    const preview = materialPackage.frameLocator("iframe");
    await expect(preview.getByRole("heading", { name: "证明 walking skeleton 可离线交付 · 固定快照" })).toBeVisible();
    await expect(preview.getByRole("heading", { name: "完整引用" })).toBeVisible();
    await expect(preview.getByText("Revision 1: developers want evidence they can keep.")).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await materialPackage.getByRole("link", { name: "下载完整 ZIP" }).click();
    const download = await downloadPromise;
    const archive = unzipSync(new Uint8Array(await readFile((await download.path())!)));
    const expectedPaths = [
      "index.html",
      "assets/styles.css",
      "assets/preview.png",
      "assets/ZCOOLXiaoWei-Regular.ttf",
      "assets/OFL.txt",
      "editorial.json",
      "render-source.json",
      "provenance.html",
      "provenance.json",
      "capability-snapshot.json",
      "asset-provenance.json",
      "manifest.json",
    ];
    expect(Object.keys(archive).sort()).toEqual(expectedPaths.sort());
    const html = strFromU8(archive["index.html"]);
    expect(html).toContain("<main>");
    expect(html).toContain("<article>");
    expect(html).toContain("完整引用");
    const manifest = JSON.parse(strFromU8(archive["manifest.json"])) as {
      entrypoint: string;
      report: { revisionNumber: number };
      sections: { renderSource: string; provenance: string[] };
      files: Array<{ path: string; bytes: number; sha256: string }>;
    };
    expect(manifest).toMatchObject({
      entrypoint: "index.html",
      report: { revisionNumber: 1 },
      sections: { renderSource: "render-source.json" },
    });
    expect(manifest.sections.provenance).toContain("provenance.json");
    expect(manifest.files.map((file) => file.path)).toContain("assets/preview.png");
    expect(Object.keys(archive).sort()).toEqual([...manifest.files.map((file) => file.path), "manifest.json"].sort());
    for (const file of manifest.files) {
      const content = archive[file.path];
      expect(content, `${file.path} must exist`).toBeTruthy();
      expect(file.bytes).toBe(content.byteLength);
      expect(file.sha256).toBe(createHash("sha256").update(content).digest("hex"));
    }
    const renderSource = JSON.parse(strFromU8(archive["render-source.json"])) as {
      rendererContract: string;
      document: { blocks: unknown[] };
    };
    expect(renderSource.rendererContract).toBe("radar-semantic-document");
    expect(renderSource.document.blocks).toHaveLength(1);
    const provenance = JSON.parse(strFromU8(archive["provenance.json"])) as {
      report: { id: string; revisionId: string };
      claims: Array<{ evidence: Array<{ signalId: string; sourceVersion: { id: string } }> }>;
    };
    expect(provenance.report.id).toBeTruthy();
    expect(provenance.report.revisionId).toBeTruthy();
    expect(provenance.claims[0].evidence[0].signalId).toBeTruthy();
    expect(provenance.claims[0].evidence[0].sourceVersion.id).toBeTruthy();
    expect(Array.from(archive["assets/preview.png"].slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);

    for (const [path, content] of Object.entries(archive)) {
      const outputPath = safeExtractionPath(extractedDirectory, path);
      await mkdir(join(outputPath, ".."), { recursive: true });
      await writeFile(outputPath, content);
    }
    const remoteRequests: string[] = [];
    page.on("request", (request) => {
      if (/^https?:/.test(request.url())) remoteRequests.push(request.url());
    });
    await page.goto(pathToFileURL(join(extractedDirectory, "index.html")).toString());
    await expect(page.getByRole("heading", { name: "证明 walking skeleton 可离线交付 · 固定快照" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "完整引用" })).toBeVisible();
    expect(remoteRequests).toEqual([]);

    await context.close();
    context = null;
    await stopRadar(radar);
    radar = null;
    radar = await startRadar(dataDirectory, 33123, {
      RADAR_AGENT_ENDPOINT: agent.endpoint,
      RADAR_AGENT_TOKEN: agent.token,
    });
    context = await browser.newContext({ acceptDownloads: true });
    page = await context.newPage();
    await page.goto("/");
    await page.getByRole("link", { name: /Walking Skeleton 验收/ }).click();
    await expect(page).toHaveURL(projectUrl);
    await expect(page.getByRole("heading", { name: "Radar Fixture Feed" })).toBeVisible();
    await expect(page.getByText("版本 1", { exact: true })).toBeVisible();
    const restoredIntelligence = page.locator("article.intelligence-item").filter({
      has: page.getByRole("heading", { name: "可报告的本地证据需求" }),
    });
    await expect(restoredIntelligence.getByText("Signal", { exact: true })).toBeVisible();
    await expect(restoredIntelligence.getByText("来源版本", { exact: true })).toBeVisible();
    await expect(page.locator("article.report-record").getByRole("heading", {
      name: "证明 walking skeleton 可离线交付 · 固定快照",
    })).toBeVisible();
    const restoredPackage = page.locator("article.material-package-record").first();
    await expect(restoredPackage.getByRole("link", { name: "下载完整 ZIP" })).toBeVisible();
    const restoredPreview = restoredPackage.frameLocator("iframe");
    await expect(restoredPreview.getByRole("heading", { name: "完整引用" })).toBeVisible();
    await expect(restoredPreview.getByText("Revision 1: developers want evidence they can keep.")).toBeVisible();
  } finally {
    await context?.close().catch(() => undefined);
    if (radar) await stopRadar(radar).catch(() => undefined);
    await feed?.close().catch(() => undefined);
    await agent?.close().catch(() => undefined);
    if (dataDirectory) await rm(dataDirectory, { recursive: true, force: true });
    if (extractedDirectory) await rm(extractedDirectory, { recursive: true, force: true });
  }
});

function safeExtractionPath(root: string, path: string): string {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(root, path);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error(`Archive entry escapes extraction directory: ${path}`);
  }
  return resolvedPath;
}
