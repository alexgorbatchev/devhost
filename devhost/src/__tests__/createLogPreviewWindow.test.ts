import { describe, expect, test } from "bun:test";

import { createLogPreviewWindow } from "../devtools/createLogPreviewWindow";
import type { ServiceLogEntry } from "../devtools/types";

function createEntry(id: number): ServiceLogEntry {
  return {
    id,
    line: `line ${id}`,
    serviceName: "api",
    stream: id % 2 === 0 ? "stderr" : "stdout",
  };
}

describe("createLogPreviewWindow", () => {
  test("returns the hovered line with ten lines of context on each side when available", () => {
    const entries: ServiceLogEntry[] = Array.from({ length: 30 }, (_, index: number): ServiceLogEntry => {
      return createEntry(index + 1);
    });

    expect(createLogPreviewWindow(entries, 15).map((entry: ServiceLogEntry): number => entry.id)).toEqual([
      6,
      7,
      8,
      9,
      10,
      11,
      12,
      13,
      14,
      15,
      16,
      17,
      18,
      19,
      20,
      21,
      22,
      23,
      24,
      25,
      26,
    ]);
  });

  test("clips the preview window at the start of the log list", () => {
    const entries: ServiceLogEntry[] = Array.from({ length: 5 }, (_, index: number): ServiceLogEntry => {
      return createEntry(index + 1);
    });

    expect(createLogPreviewWindow(entries, 0).map((entry: ServiceLogEntry): number => entry.id)).toEqual([
      1,
      2,
      3,
      4,
      5,
    ]);
  });
});
