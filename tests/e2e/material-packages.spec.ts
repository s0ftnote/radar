import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { startFeedFixture } from "./support/feed-fixture";
import { startRadar, stopRadar } from "./support/radar-process";
import { startReportAgentFixture } from "./support/report-agent-fixture";

test.setTimeout(120_000);

test("Report 自动派生可离线预览和下载的 HTML 平台物料包", async ({ browser }) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "radar-material-packages-"));
  const extractedDirectory = await mkdtemp(join(tmpdir(), "radar-html-package-"));
  const feed = await startFeedFixture();
  feed.useCredentialedEntryUrl();
  const agent = await startReportAgentFixture();
  let radar = await startRadar(dataDirectory, 33123, {
    RADAR_AGENT_ENDPOINT: agent.endpoint,
    RADAR_AGENT_TOKEN: agent.token,
  });
  let context = await browser.newContext({ acceptDownloads: true });
  let page = await context.newPage();

  try {
    await page.goto("/");
    await page.getByLabel("Project 名称").fill("离线 HTML 交付");
    await page.getByLabel("Radar Brief").fill("寻找需要把可追溯证据交付为离线 HTML 的明确需求。");
    await page.getByRole("button", { name: "创建 Radar Project" }).click();
    await page.getByRole("link", { name: /离线 HTML 交付/ }).click();
    await expect(page.getByRole("heading", { name: "离线 HTML 交付" })).toBeVisible();
    const projectUrl = page.url();

    await page.getByLabel("公开 RSS/Atom URL").fill(`${feed.url}/feed`);
    await page.getByRole("button", { name: "验证并保存" }).click();
    await page.getByRole("button", { name: "采集 Radar Fixture Feed" }).click();
    await page.getByRole("button", { name: "运行 Radar 判断" }).click();
    await expect(page.getByRole("heading", { name: "可报告的本地证据需求" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "HTML 平台物料包" })).toBeVisible();
    await expect(page.getByText("还没有 HTML 物料包")).toBeVisible();

    await createReport(page, "离线证据交付", "研究团队", "让完整引用跟随内容离线移动");
    await expect(page.locator("article.report-record").getByRole("heading", { name: "离线证据交付 · 固定快照" })).toBeVisible();
    const firstPackage = page.locator("article.material-package-record").first();
    await expect(firstPackage.getByText(/^物料包身份/)).toBeVisible();
    await expect(firstPackage.getByRole("link", { name: "固定 Report 修订 1" })).toBeVisible();
    for (const section of ["Editorial", "Render source", "Derivatives", "Provenance", "Capability snapshot"]) {
      await expect(firstPackage.getByText(section, { exact: true })).toBeVisible();
    }
    const preview = firstPackage.frameLocator("iframe[title='离线证据交付 · 固定快照的离线 HTML 预览']");
    await expect(preview.getByRole("heading", { name: "离线证据交付 · 固定快照" })).toBeVisible();
    await expect(preview.getByText("可报告的本地证据需求：开发者需要把本地证据链组织成可追溯主张。")).toBeVisible();
    await expect(preview.getByRole("heading", { name: "完整引用" })).toBeVisible();
    const citation = preview.getByRole("link", { name: /^引用 1：/ }).first();
    const citationTarget = await citation.getAttribute("href");
    expect(citationTarget).toMatch(/^#reference-/);
    await expect(preview.locator(citationTarget!)).toHaveCount(1);
    await expect(preview.getByText(/^Report 修订$/)).toBeVisible();
    await expect(preview.getByText(/^判断修订$/)).toBeVisible();
    await expect(preview.getByText(/^来源版本$/)).toBeVisible();
    await expect(preview.getByText(/部分引用没有经来源适配器确认的公开 canonical locator/)).toBeVisible();
    await expect(preview.getByRole("img", { name: "离线证据交付 · 固定快照的 PNG 预览" })).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await firstPackage.getByRole("link", { name: "下载完整 ZIP" }).click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(download.suggestedFilename()).toMatch(/^radar-html-package-.*\.zip$/);
    const archive = unzipSync(new Uint8Array(await readFile(downloadPath!)));
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

    const manifest = JSON.parse(strFromU8(archive["manifest.json"])) as {
      packageId: string;
      createdAt: string;
      report: { revisionNumber: number };
      sections: Record<string, unknown>;
      files: Array<{ path: string; mediaType: string; bytes: number; sha256: string }>;
    };
    expect(manifest.packageId).toBeTruthy();
    expect(manifest.report.revisionNumber).toBe(1);
    expect(Object.keys(manifest.sections).sort()).toEqual([
      "capabilitySnapshot",
      "derivatives",
      "editorial",
      "provenance",
      "renderSource",
    ]);
    expect(Object.keys(archive).sort()).toEqual([...manifest.files.map((file) => file.path), "manifest.json"].sort());
    for (const file of manifest.files) {
      const content = archive[file.path];
      expect(content, `${file.path} must exist`).toBeTruthy();
      expect(file.bytes).toBe(content.byteLength);
      expect(file.mediaType).toBe(expectedMediaType(file.path));
      expect(file.sha256).toBe(createHash("sha256").update(content).digest("hex"));
    }
    expect(Array.from(archive["assets/preview.png"].slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const assetProvenance = JSON.parse(strFromU8(archive["asset-provenance.json"])) as {
      assets: Array<{
        path: string;
        source?: string;
        acquiredAt?: string;
        bundledAt?: string;
        license?: string;
        generationContext: { renderSourceSha256?: string };
      }>;
    };
    expect(assetProvenance.assets.find((asset) => asset.path === "assets/preview.png")?.generationContext.renderSourceSha256)
      .toBe(createHash("sha256").update(archive["render-source.json"]).digest("hex"));
    expect(assetProvenance.assets.find((asset) => asset.path.endsWith(".ttf"))).toMatchObject({
      source: "https://github.com/googlefonts/zcool-xiaowei/",
      acquiredAt: "2026-08-24T11:13:27.000Z",
      bundledAt: manifest.createdAt,
      license: "SIL Open Font License 1.1",
    });
    const provenance = JSON.parse(strFromU8(archive["provenance.json"])) as {
      claims: Array<{ evidence: Array<{ sourceVersion: { publicLocator: Record<string, unknown> } }> }>;
    };
    expect(provenance.claims[0].evidence[0].sourceVersion.publicLocator).toEqual({
      status: "withheld",
      site: "https://example.test/",
      reason: "unverified_public_locator",
    });

    const bundleText = Object.entries(archive)
      .filter(([path]) => !path.endsWith(".png") && !path.endsWith(".ttf"))
      .map(([, value]) => strFromU8(value))
      .join("\n");
    expect(bundleText).toContain("https://example.test/");
    expect(bundleText).not.toContain("/session/");
    expect(bundleText).not.toContain("code=");
    expect(bundleText).not.toContain("session=");
    expect(bundleText).not.toContain("source-fixture-secret");
    expect(bundleText).not.toContain(agent.token);
    expect(bundleText).not.toContain("RADAR_AGENT_TOKEN");
    expect(bundleText).not.toMatch(/https?:\/\/[^"'<\s]+\.(?:css|js|png|jpe?g|webp|woff2?)/i);

    for (const [path, content] of Object.entries(archive)) {
      const outputPath = join(extractedDirectory, path);
      await mkdir(join(outputPath, ".."), { recursive: true });
      await writeFile(outputPath, content);
    }
    const remoteRequests: string[] = [];
    page.on("request", (request) => {
      if (/^https?:/.test(request.url())) remoteRequests.push(request.url());
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(pathToFileURL(join(extractedDirectory, "index.html")).toString());
    await expect(page.getByRole("heading", { name: "离线证据交付 · 固定快照" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "完整引用" })).toBeVisible();
    await expect(page.getByText("Revision 1: developers want evidence they can keep.")).toBeVisible();
    await expect(page.locator("main")).toHaveCSS("display", "block");
    expect(remoteRequests).toEqual([]);

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(projectUrl);
    const packageDirectory = join(dataDirectory, "material-packages");
    await chmod(packageDirectory, 0o500);
    try {
      await createReport(page, "第二份仍成功的 Report", "本地运维者", "包失败不能改变 Report");
      await expect(page.locator("article.report-record")).toHaveCount(2);
      await expect(page.getByRole("heading", { name: "重试 HTML 物料包" })).toBeVisible();
      const failedRun = page.locator("li.material-package-run").filter({ hasText: "第二份仍成功的 Report" });
      await expect(failedRun.getByText("失败", { exact: true })).toBeVisible();
      await expect(failedRun).toContainText("HTML 物料包生成失败");
    } finally {
      await chmod(packageDirectory, 0o700);
    }

    const failedRun = page.locator("li.material-package-run").filter({ hasText: "第二份仍成功的 Report" });
    await page.route("**/api/projects/*/material-packages", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.continue();
    });
    await failedRun.getByRole("button", { name: "重试 HTML 包" }).click();
    await expect(failedRun.getByRole("button", { name: "正在重试 HTML 包…" })).toBeDisabled();
    await expect(page.locator("article.material-package-record")).toHaveCount(2);
    await expect(failedRun.getByText(/^已由运行 .* 恢复$/)).toBeVisible();
    await expect(failedRun.getByRole("button", { name: "重试 HTML 包" })).toHaveCount(0);
    await page.unroute("**/api/projects/*/material-packages");

    await page.getByLabel("选择补发 Report").selectOption({ label: "离线证据交付 · 固定快照 · 修订 1" });
    await page.getByRole("button", { name: "补发 HTML 包" }).click();
    await expect(page.locator("article.material-package-record")).toHaveCount(3);
    await expect(page.locator("li.material-package-run")).toHaveCount(4);

    await context.close();
    await stopRadar(radar);
    radar = await startRadar(dataDirectory, 33123, {
      RADAR_AGENT_ENDPOINT: agent.endpoint,
      RADAR_AGENT_TOKEN: agent.token,
    });
    context = await browser.newContext({ acceptDownloads: true });
    page = await context.newPage();
    await page.goto(projectUrl);
    await expect(page.locator("article.material-package-record")).toHaveCount(3);
    await expect(page.locator("li.material-package-run")).toHaveCount(4);
    await expect(page.getByText("HTML 物料包生成失败", { exact: false })).toBeVisible();
    await expect(page.locator("article.material-package-record").first().getByRole("link", { name: "下载完整 ZIP" })).toBeVisible();
    const latestPackage = page.locator("article.material-package-record").first();
    await expect(latestPackage.locator("iframe")).toBeVisible();
    await expect(page.locator("article.material-package-record iframe")).toHaveCount(1);
    const restartedPreview = latestPackage.frameLocator("iframe");
    await expect(restartedPreview.getByRole("heading", { name: "离线证据交付 · 固定快照" })).toBeVisible();
    await expect(restartedPreview.getByRole("heading", { name: "完整引用" })).toBeVisible();
    const restartedDownloadPromise = page.waitForEvent("download");
    await latestPackage.getByRole("link", { name: "下载完整 ZIP" }).click();
    const restartedDownload = await restartedDownloadPromise;
    const restartedArchive = unzipSync(new Uint8Array(await readFile((await restartedDownload.path())!)));
    expect(JSON.parse(strFromU8(restartedArchive["manifest.json"])).packageId).toBeTruthy();

    await page.getByLabel("选择 可报告的本地证据需求 修订 1").check();
    await page.getByLabel("内容目的").fill("中断包恢复");
    await page.getByLabel("目标受众").fill("本地运维者");
    await page.getByLabel("核心角度").fill("中断 HTML 包");
    await page.getByRole("button", { name: "生成 Report" }).click();
    const interrupted = await waitForRunningMaterialPackage(dataDirectory);
    await stopRadar(radar);
    await context.close();

    expect(await pathExists(join(dataDirectory, "material-packages", ".staging", interrupted.runId))).toBe(true);
    await chmod(join(dataDirectory, "material-packages", ".staging"), 0o500);
    radar = await startRadar(dataDirectory, 33123, {
      RADAR_AGENT_ENDPOINT: agent.endpoint,
      RADAR_AGENT_TOKEN: agent.token,
    });
    context = await browser.newContext({ acceptDownloads: true });
    page = await context.newPage();
    await page.goto(projectUrl);
    const interruptedRun = page.locator("li.material-package-run").filter({ hasText: "中断包恢复 · 固定快照" });
    await expect(interruptedRun.getByText("失败", { exact: true })).toBeVisible();
    await expect(interruptedRun).toContainText("文件写入完成前停止");
    await expect(interruptedRun).toContainText("清理未完成（staging）");
    expect(await pathExists(join(dataDirectory, "material-packages", ".staging", interrupted.runId))).toBe(true);
    expect(await pathExists(join(dataDirectory, "material-packages", interrupted.packageId, interrupted.runId))).toBe(false);
    await chmod(join(dataDirectory, "material-packages", ".staging"), 0o700);
    await interruptedRun.getByRole("button", { name: "重试 HTML 包" }).click();
    await expect(interruptedRun.getByText(/^已由运行 .* 恢复$/)).toBeVisible();
    expect(await pathExists(join(dataDirectory, "material-packages", ".staging", interrupted.runId))).toBe(false);
    await expect(page.locator("article.material-package-record")).toHaveCount(4);
    await expect(page.locator("li.material-package-run")).toHaveCount(6);
  } finally {
    await context.close().catch(() => undefined);
    await stopRadar(radar).catch(() => undefined);
    await feed.close().catch(() => undefined);
    await agent.close().catch(() => undefined);
    await chmod(join(dataDirectory, "material-packages"), 0o700).catch(() => undefined);
    await chmod(join(dataDirectory, "material-packages", ".staging"), 0o700).catch(() => undefined);
    await rm(dataDirectory, { recursive: true, force: true });
    await rm(extractedDirectory, { recursive: true, force: true });
  }
});

async function createReport(
  page: import("@playwright/test").Page,
  purpose: string,
  audience: string,
  angle: string,
): Promise<void> {
  await page.getByLabel("选择 可报告的本地证据需求 修订 1").check();
  await page.getByLabel("内容目的").fill(purpose);
  await page.getByLabel("目标受众").fill(audience);
  await page.getByLabel("核心角度").fill(angle);
  await page.getByRole("button", { name: "生成 Report" }).click();
}

function expectedMediaType(path: string): string {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".txt")) return "text/plain; charset=utf-8";
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".ttf")) return "font/ttf";
  return "application/octet-stream";
}

async function waitForRunningMaterialPackage(
  dataDirectory: string,
): Promise<{ runId: string; packageId: string }> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const db = new DatabaseSync(join(dataDirectory, "radar.sqlite"));
    const row = db.prepare(
      `SELECT run.id AS run_id, run.material_package_id
       FROM material_package_runs AS run
       WHERE run.status = 'running'
       ORDER BY run.started_at DESC LIMIT 1`,
    ).get() as { run_id: string; material_package_id: string } | undefined;
    db.close();
    if (row && await pathExists(join(dataDirectory, "material-packages", ".staging", row.run_id))) {
      return { runId: row.run_id, packageId: row.material_package_id };
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for an in-progress HTML package write.");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
