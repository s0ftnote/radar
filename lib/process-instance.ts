import { randomUUID } from "node:crypto";

declare global {
  var __radarProcessInstanceId: string | undefined;
}

export const processInstanceId = globalThis.__radarProcessInstanceId ?? randomUUID();
globalThis.__radarProcessInstanceId = processInstanceId;
