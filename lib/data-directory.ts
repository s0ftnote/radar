import { homedir } from "node:os";
import { resolve } from "node:path";

/**
 * Radar 装成全局命令后可以在任意 cwd 起服务，所以数据目录不能跟着 cwd 走。
 * 默认是用户主目录下的 `.radar`；`RADAR_DATA_DIR` 覆盖它（测试与多实例用）。
 */
export function radarDataDirectory(): string {
  const configured = process.env.RADAR_DATA_DIR;
  return configured ? resolve(configured) : resolve(homedir(), ".radar");
}
