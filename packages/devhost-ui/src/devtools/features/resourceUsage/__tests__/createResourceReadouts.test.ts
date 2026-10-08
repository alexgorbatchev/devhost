import { describe, expect, test } from "bun:test";

import { createResourceReadouts } from "../createResourceReadouts";
import type { IResourceReadout, ResourceLevel } from "../types";

type LevelCase = [percent: number, level: ResourceLevel];

describe("createResourceReadouts", () => {
  test("lists CPU, RAM, and Disk in that order with whole percentages and the figures behind them", () => {
    expect(
      createResourceReadouts({
        disk: { percent: 41.4, usedBytes: 212_000_000_000, totalBytes: 512_000_000_000 },
        memory: { percent: 30.6, usedBytes: 9_800_000_000, totalBytes: 32_000_000_000 },
        cpu: { percent: 17.5, cores: 8 },
      }),
    ).toEqual([
      { key: "cpu", label: "CPU", percent: 18, detail: "18% of 8 cores", level: "normal" },
      { key: "memory", label: "RAM", percent: 31, detail: "9.8 of 32 GB used", level: "normal" },
      { key: "disk", label: "Disk", percent: 41, detail: "212 of 512 GB used", level: "normal" },
    ]);
  });

  test("leaves out readouts without a reading", () => {
    const readouts: IResourceReadout[] = createResourceReadouts({
      memory: { percent: 50, usedBytes: 1_000_000_000, totalBytes: 2_000_000_000 },
    });

    expect(readouts.map((readout: IResourceReadout): string => readout.key)).toEqual(["memory"]);
    expect(createResourceReadouts({})).toEqual([]);
  });

  test.each<LevelCase>([
    [69.4, "normal"],
    [69.5, "warning"],
    [89.4, "warning"],
    [89.5, "danger"],
    [100, "danger"],
  ])("rates %d%% as %s, by the percentage shown", (percent: number, level: ResourceLevel) => {
    expect(createResourceReadouts({ cpu: { percent, cores: 4 } }).at(0)?.level).toBe(level);
  });

  test("keeps a reading outside 0 to 100 inside the scale", () => {
    expect(createResourceReadouts({ cpu: { percent: 100.4, cores: 4 } }).at(0)?.percent).toBe(100);
    expect(createResourceReadouts({ cpu: { percent: -0.2, cores: 4 } }).at(0)?.percent).toBe(0);
  });

  test("names a single core in the singular and omits an unknown core count", () => {
    expect(createResourceReadouts({ cpu: { percent: 5, cores: 1 } }).at(0)?.detail).toBe("5% of 1 core");
    expect(createResourceReadouts({ cpu: { percent: 5, cores: 0 } }).at(0)?.detail).toBe("5%");
  });
});
