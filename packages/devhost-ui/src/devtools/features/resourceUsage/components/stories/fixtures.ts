import type { IResourceUsage } from "../../types";

const totalMemoryBytes: number = 32_000_000_000;
const totalDiskBytes: number = 512_000_000_000;

/** Every readout below the warning level. */
export const fixture_calmUsage: IResourceUsage = {
  cpu: { cores: 8, percent: 18.2 },
  disk: { percent: 41.4, totalBytes: totalDiskBytes, usedBytes: 212_000_000_000 },
  memory: { percent: 30.6, totalBytes: totalMemoryBytes, usedBytes: 9_800_000_000 },
};

/** One readout at each level: CPU normal, memory warning, disk critical. */
export const fixture_mixedLevelUsage: IResourceUsage = {
  cpu: { cores: 8, percent: 18.2 },
  disk: { percent: 97.3, totalBytes: totalDiskBytes, usedBytes: 498_000_000_000 },
  memory: { percent: 81.6, totalBytes: totalMemoryBytes, usedBytes: 26_100_000_000 },
};

export function factory_cpuUsage(percent: number): IResourceUsage {
  return { ...fixture_calmUsage, cpu: { cores: 8, percent } };
}
