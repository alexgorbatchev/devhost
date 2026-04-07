import { describe, expect, test } from "bun:test";

import { createVisibleLogRows } from "../createVisibleLogRows";
import type { ServiceLogEntry } from "../../../shared/types";

describe("createVisibleLogRows", () => {
  test("splits long log lines into visible wrapped rows with matching text slices", () => {
    const entries: ServiceLogEntry[] = [
      {
        id: 1,
        line: "x".repeat(90),
        serviceName: "api",
        stream: "stderr",
      },
    ];

    expect(createVisibleLogRows(entries, 8, 100)).toEqual([
      {
        entryIndex: 0,
        height: 2,
        id: 1,
        stream: "stderr",
        text: "x".repeat(80),
        top: 3,
        width: 100,
      },
      {
        entryIndex: 0,
        height: 2,
        id: 1,
        stream: "stderr",
        text: "x".repeat(10),
        top: 6,
        width: 13,
      },
    ]);
  });
});
