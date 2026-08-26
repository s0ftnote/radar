import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { packageRoot } from "./package-root.js";

let cached: string | undefined;

export function radarVersion(): string {
  cached ??= (
    JSON.parse(readFileSync(resolve(packageRoot(), "package.json"), "utf8")) as {
      version: string;
    }
  ).version;
  return cached;
}
