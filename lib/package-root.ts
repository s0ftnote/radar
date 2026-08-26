import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * 编译产物落在 `<包根>/dist/**`，静态资源落在 `<包根>/assets/`。
 * 用模块自身的位置定位包根，`radar` 因此在任意 cwd 下都找得到字体与样式。
 */
export function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}
