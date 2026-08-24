import { resolve } from "node:path";

export function radarDataDirectory(): string {
  return resolve(/* turbopackIgnore: true */ process.env.RADAR_DATA_DIR ?? ".radar");
}
