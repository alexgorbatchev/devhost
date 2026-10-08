import { RESOURCE_DANGER_PERCENT, RESOURCE_WARNING_PERCENT } from "./constants";
import type { IResourceReadout, IResourceUsage, ISpaceUsage, ResourceLevel, ResourceReadoutKey } from "./types";

const BYTES_PER_GIGABYTE: number = 1_000_000_000;

/** Turns the latest readings into the toolbar's readouts, in display order. */
export function createResourceReadouts(usage: IResourceUsage): IResourceReadout[] {
  const readouts: IResourceReadout[] = [];

  if (usage.cpu !== undefined) {
    const percent: number = toDisplayPercent(usage.cpu.percent);
    const { cores } = usage.cpu;
    const coreCount: string = cores > 0 ? ` of ${cores} ${cores === 1 ? "core" : "cores"}` : "";

    readouts.push(createReadout("cpu", "CPU", percent, `${percent}%${coreCount}`));
  }

  if (usage.memory !== undefined) {
    readouts.push(createSpaceReadout("memory", "RAM", usage.memory));
  }

  if (usage.disk !== undefined) {
    readouts.push(createSpaceReadout("disk", "Disk", usage.disk));
  }

  return readouts;
}

function createSpaceReadout(key: ResourceReadoutKey, label: string, usage: ISpaceUsage): IResourceReadout {
  return createReadout(
    key,
    label,
    toDisplayPercent(usage.percent),
    `${formatGigabytes(usage.usedBytes)} of ${formatGigabytes(usage.totalBytes)} GB used`,
  );
}

function createReadout(key: ResourceReadoutKey, label: string, percent: number, detail: string): IResourceReadout {
  return { key, label, percent, detail, level: resolveLevel(percent) };
}

function toDisplayPercent(percent: number): number {
  return Math.min(100, Math.max(0, Math.round(percent)));
}

// The level follows the percentage shown, so a readout never reads "70%" while still looking normal.
function resolveLevel(percent: number): ResourceLevel {
  if (percent >= RESOURCE_DANGER_PERCENT) {
    return "danger";
  }

  if (percent >= RESOURCE_WARNING_PERCENT) {
    return "warning";
  }

  return "normal";
}

// One decimal below 100 GB, none above; a trailing ".0" is dropped.
function formatGigabytes(bytes: number): string {
  const gigabytes: number = bytes / BYTES_PER_GIGABYTE;

  return gigabytes < 100 ? String(Number(gigabytes.toFixed(1))) : String(Math.round(gigabytes));
}
