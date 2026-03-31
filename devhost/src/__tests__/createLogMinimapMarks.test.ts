import { describe, expect, test } from "bun:test";

import { createLogMinimapMarks } from "../devtools/createLogMinimapMarks";
import type { ServiceLogEntry } from "../devtools/types";

describe("createLogMinimapMarks", () => {
  test("anchors visible marks to the bottom with consistent spacing", () => {
    const entries: ServiceLogEntry[] = [
      {
        id: 1,
        line: "first line",
        serviceName: "api",
        stream: "stdout",
      },
      {
        id: 2,
        line: "second line",
        serviceName: "api",
        stream: "stderr",
      },
    ];

    expect(createLogMinimapMarks(entries, 40, 100)).toEqual([
      {
        entryIndex: 0,
        height: 2,
        id: 1,
        stream: "stdout",
        top: 35,
        width: 13,
      },
      {
        entryIndex: 1,
        height: 2,
        id: 2,
        stream: "stderr",
        top: 38,
        width: 14,
      },
    ]);
  });

  test("keeps only the newest marks when the viewport is full", () => {
    const entries: ServiceLogEntry[] = [
      {
        id: 1,
        line: "one",
        serviceName: "api",
        stream: "stdout",
      },
      {
        id: 2,
        line: "two",
        serviceName: "api",
        stream: "stdout",
      },
      {
        id: 3,
        line: "three",
        serviceName: "api",
        stream: "stdout",
      },
      {
        id: 4,
        line: "four",
        serviceName: "api",
        stream: "stderr",
      },
      {
        id: 5,
        line: "five",
        serviceName: "api",
        stream: "stdout",
      },
    ];

    expect(createLogMinimapMarks(entries, 8, 100)).toEqual([
      {
        entryIndex: 2,
        height: 2,
        id: 3,
        stream: "stdout",
        top: 0,
        width: 12,
      },
      {
        entryIndex: 3,
        height: 2,
        id: 4,
        stream: "stderr",
        top: 3,
        width: 12,
      },
      {
        entryIndex: 4,
        height: 2,
        id: 5,
        stream: "stdout",
        top: 6,
        width: 12,
      },
    ]);
  });

  test("wraps long log lines into multiple stacked marks", () => {
    const entries: ServiceLogEntry[] = [
      {
        id: 1,
        line: "old line",
        serviceName: "api",
        stream: "stdout",
      },
      {
        id: 2,
        line: "x".repeat(200),
        serviceName: "api",
        stream: "stderr",
      },
    ];

    expect(createLogMinimapMarks(entries, 8, 100)).toEqual([
      {
        entryIndex: 1,
        height: 2,
        id: 2,
        stream: "stderr",
        top: 0,
        width: 100,
      },
      {
        entryIndex: 1,
        height: 2,
        id: 2,
        stream: "stderr",
        top: 3,
        width: 100,
      },
      {
        entryIndex: 1,
        height: 2,
        id: 2,
        stream: "stderr",
        top: 6,
        width: 50,
      },
    ]);
  });
});
