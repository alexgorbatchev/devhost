import type { ICpuUsage, IResourceUsage, ISpaceUsage } from "./types";

/** Reads one frame of the resource usage stream. The result is `null` for a frame that is not a usage message. */
export function parseResourceUsageMessage(frame: unknown): IResourceUsage | null {
  if (typeof frame !== "string") {
    return null;
  }

  const value: unknown = parseJson(frame);

  return isResourceUsage(value) ? value : null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isResourceUsage(value: unknown): value is IResourceUsage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const cpu: unknown = Reflect.get(value, "cpu");
  const memory: unknown = Reflect.get(value, "memory");
  const disk: unknown = Reflect.get(value, "disk");

  return (
    (cpu === undefined || isCpuUsage(cpu)) &&
    (memory === undefined || isSpaceUsage(memory)) &&
    (disk === undefined || isSpaceUsage(disk))
  );
}

function isCpuUsage(value: unknown): value is ICpuUsage {
  return hasFiniteNumbers(value, ["percent", "cores"]);
}

function isSpaceUsage(value: unknown): value is ISpaceUsage {
  return hasFiniteNumbers(value, ["percent", "usedBytes", "totalBytes"]);
}

function hasFiniteNumbers(value: unknown, keys: string[]): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    keys.every((key: string): boolean => Number.isFinite(Reflect.get(value, key)))
  );
}
