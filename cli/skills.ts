import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { packageRoot } from "../lib/package-root.js";

/**
 * 四份 Skill 随 Radar 仓库来，装的就是随本版 Radar 一起下来的那四份——
 * 版本靠路径匹配，不做 Skill 与 CLI 的版本检测，也没有契约版本号。
 */
export function shippedSkillsDirectory(): string {
  return resolve(packageRoot(), "skills");
}

/**
 * `~/.agents/skills` 是跨 Agent 的公共位置，不是某一家的目录。Radar 不挑
 * Agent——它不调用任何模型，四份 Skill 由用户自己那个 Agent 执行（ADR 0009），
 * 装进谁的私有目录都是替用户做了不该做的选择。
 */
export function defaultSkillsTarget(): string {
  return resolve(homedir(), ".agents", "skills");
}

/**
 * 幂等覆盖：每份 Skill 先删掉整个目录再拷进去，装两次和装一次结果一样，
 * 上一版留下的文件也不会赖着不走。只碰这四份，同目录下别人的 Skill 不动。
 */
export function installSkills(targetDirectory: string): string[] {
  const source = shippedSkillsDirectory();
  const names = readdirSync(source, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  mkdirSync(targetDirectory, { recursive: true });
  for (const name of names) {
    const destination = resolve(targetDirectory, name);
    rmSync(destination, { recursive: true, force: true });
    cpSync(resolve(source, name), destination, { recursive: true });
  }
  return names;
}
