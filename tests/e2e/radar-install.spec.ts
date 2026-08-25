import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import {
  delay,
  portIsListening,
  repositoryRoot,
  startRadar,
  stopRadar,
  type RunningRadar,
} from "./support/radar-process.js";

const run = promisify(execFile);

/**
 * 这一组验收的是「装上之后能跑」，不是领域行为：`npm i -g` 之后 `radar` 在任意
 * cwd 下起得来、只听 loopback、Ctrl-C 干净退出、同一数据目录不被两个实例争抢。
 */

test.describe("装好的 Radar", () => {
  test.describe.configure({ mode: "serial" });

  let workspace: string;
  let installedRadar: string;

  test.beforeAll(async () => {
    test.setTimeout(300_000);
    workspace = await mkdtemp(join(tmpdir(), "radar-install-"));
    const packed = await mkdtemp(join(tmpdir(), "radar-pack-"));
    const { stdout } = await run("npm", ["pack", "--pack-destination", packed], {
      cwd: repositoryRoot,
    });
    const tarball = resolve(packed, stdout.trim().split("\n").at(-1)!);

    const target = join(workspace, "install");
    await run("npm", ["init", "--yes"], { cwd: workspace }).catch(() => undefined);
    await run("npm", ["install", "--prefix", target, "--no-audit", "--no-fund", tarball], {
      cwd: workspace,
      timeout: 240_000,
    });
    installedRadar = join(target, "node_modules", ".bin", "radar");
    await rm(packed, { recursive: true, force: true });
  });

  test.afterAll(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  test("`radar --help` 列出当前命令面", async () => {
    const { stdout } = await run(installedRadar, ["--help"], { cwd: tmpdir() });
    expect(stdout).toContain("radar up");
    expect(stdout).toContain("radar status");
    expect(stdout).toContain("RADAR_DATA_DIR");
  });

  test("在任意 cwd 下起服务，字体与样式照样送得出", async () => {
    test.setTimeout(90_000);
    const dataDirectory = await mkdtemp(join(tmpdir(), "radar-anycwd-"));
    // 故意在一个跟仓库和安装目录都无关的 cwd 下起：静态资源不能跟着 cwd 走。
    const elsewhere = await mkdtemp(join(tmpdir(), "radar-elsewhere-"));
    let radar: RunningRadar | null = null;
    try {
      radar = await startRadar(dataDirectory, {
        port: 33141,
        command: [installedRadar],
        cwd: elsewhere,
      });

      const page = await fetch(`http://127.0.0.1:${radar.port}/`);
      expect(page.ok).toBeTruthy();
      expect(await page.text()).toContain("/assets/styles.css");

      const styles = await fetch(`http://127.0.0.1:${radar.port}/assets/styles.css`);
      expect(styles.status).toBe(200);
      expect(await styles.text()).toContain("ZCOOL XiaoWei");

      const font = await fetch(`http://127.0.0.1:${radar.port}/assets/fonts/ZCOOLXiaoWei-Regular.ttf`);
      expect(font.status).toBe(200);
      expect((await font.arrayBuffer()).byteLength).toBeGreaterThan(10_000);

      // 只绑 127.0.0.1：不该在任何外部网卡上出现。
      const { port } = radar;
      const { stdout } = await run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]);
      const listening = stdout
        .trim()
        .split("\n")
        .slice(1)
        .map((line) => line.split(/\s+/).at(-2)!);
      expect(listening.length).toBeGreaterThan(0);
      expect(listening.every((address) => address === `127.0.0.1:${port}`)).toBe(true);
    } finally {
      if (radar) await stopRadar(radar);
      await rm(dataDirectory, { recursive: true, force: true });
      await rm(elsewhere, { recursive: true, force: true });
    }
  });

  test("SIGINT 与 SIGTERM 都干净退出并释放端口", async () => {
    test.setTimeout(90_000);
    const dataDirectory = await mkdtemp(join(tmpdir(), "radar-signals-"));
    try {
      for (const signal of ["SIGINT", "SIGTERM"] as const) {
        const radar = await startRadar(dataDirectory, { port: 33142, command: [installedRadar] });
        radar.process.kill(signal);
        const [code] = await new Promise<[number | null]>((done) =>
          radar.process.once("exit", (exitCode) => done([exitCode])),
        );
        expect(code).toBe(0);
        expect(await portIsListening(radar.port)).toBe(false);
      }
    } finally {
      await rm(dataDirectory, { recursive: true, force: true });
    }
  });

  test("同一数据目录起第二个实例时明确失败，服务是唯一写者", async () => {
    test.setTimeout(90_000);
    const dataDirectory = await mkdtemp(join(tmpdir(), "radar-single-"));
    let radar: RunningRadar | null = null;
    try {
      radar = await startRadar(dataDirectory, { port: 33143, command: [installedRadar] });

      const second = await run(installedRadar, ["up", "--port", "33144"], {
        cwd: tmpdir(),
        env: { ...process.env, RADAR_DATA_DIR: dataDirectory },
      }).catch((error: { code: number; stderr: string }) => error);
      expect("code" in second && second.code).toBe(1);
      expect((second as { stderr: string }).stderr).toContain("只能有一个服务");
      expect(await portIsListening(33144)).toBe(false);

      // 抢锁失败不是静默争抢 SQLite：数据目录里仍然只有第一个实例登记着。
      const runtime = JSON.parse(await readFile(join(dataDirectory, "service.json"), "utf8"));
      expect(runtime.pid).toBe(radar.process.pid);
      expect(runtime.port).toBe(33143);
    } finally {
      if (radar) await stopRadar(radar);
      await rm(dataDirectory, { recursive: true, force: true });
    }
  });

  test("陈旧的锁不会永远卡住数据目录", async () => {
    test.setTimeout(90_000);
    const dataDirectory = await mkdtemp(join(tmpdir(), "radar-stalelock-"));
    let radar: RunningRadar | null = null;
    try {
      // pid 会被系统回收：这里登记一个活着但根本不是 Radar 的进程（测试自己），
      // 端口上也没人听。只看 pid 的实现会把数据目录永久锁死。
      await writeFile(
        join(dataDirectory, "service.json"),
        JSON.stringify({ pid: process.pid, port: 33199, startedAt: new Date().toISOString() }),
      );

      radar = await startRadar(dataDirectory, { port: 33146, command: [installedRadar] });
      expect((await (await fetch(`http://127.0.0.1:${radar.port}/health`)).json()).ok).toBe(true);
    } finally {
      if (radar) await stopRadar(radar);
      await rm(dataDirectory, { recursive: true, force: true });
    }
  });

  test("重启后既有数据完好，CLI 够不到服务时如实报错", async () => {
    test.setTimeout(90_000);
    const dataDirectory = await mkdtemp(join(tmpdir(), "radar-restart-"));
    let radar: RunningRadar | null = null;
    try {
      radar = await startRadar(dataDirectory, { port: 33145, command: [installedRadar] });

      const created = await fetch(`http://127.0.0.1:${radar.port}/briefs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "重启之后还得在",
          body: "本地实例的资产不因为进程走了就没了。",
        }),
      });
      expect(created.status).toBe(201);
      const brief = (await created.json()) as { id: string };

      const { stdout } = await run(installedRadar, ["status"], {
        cwd: tmpdir(),
        env: { ...process.env, RADAR_DATA_DIR: dataDirectory },
      });
      expect(stdout).toContain(dataDirectory);

      await stopRadar(radar);

      // 服务停了，CLI 只能如实报错——它自己不碰 SQLite。
      const offline = await run(installedRadar, ["status"], {
        cwd: tmpdir(),
        env: { ...process.env, RADAR_DATA_DIR: dataDirectory },
      }).catch((error: { code: number; stderr: string }) => error);
      expect("code" in offline && offline.code).toBe(1);
      expect((offline as { stderr: string }).stderr).toContain("没有在运行");

      radar = await startRadar(dataDirectory, { port: 33145, command: [installedRadar] });
      const briefs = (await (await fetch(`http://127.0.0.1:${radar.port}/briefs`)).json()) as Array<{
        id: string;
      }>;
      expect(briefs.map((entry) => entry.id)).toContain(brief.id);
    } finally {
      if (radar) await stopRadar(radar);
      await delay(50);
      await rm(dataDirectory, { recursive: true, force: true });
    }
  });
});
