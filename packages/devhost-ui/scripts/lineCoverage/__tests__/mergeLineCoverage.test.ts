import { describe, expect, test } from "bun:test";
import { lcovParser, type SectionSummary } from "@friedemannsommer/lcov-parser";

import { mergeLineCoverage } from "../mergeLineCoverage";

/** Reads a report written the way the test runners write it: one `SF` section per file, one `DA` record per line. */
async function parseReport(sections: Record<string, Record<number, number>>): Promise<SectionSummary[]> {
  const report: string = Object.entries(sections)
    .map(([path, lineHits]): string => {
      const records: string[] = Object.entries(lineHits).map(([line, hit]): string => `DA:${line},${hit}`);

      return [`SF:${path}`, ...records, "end_of_record"].join("\n");
    })
    .join("\n");

  return await lcovParser({ from: report });
}

describe("mergeLineCoverage", () => {
  test("counts a line as covered when any report saw it run", async () => {
    const unitReport = await parseReport({ "src/devtools/readLabel.ts": { 1: 1, 2: 0, 3: 0, 4: 0 } });
    const browserReport = await parseReport({ "src/devtools/readLabel.ts": { 1: 0, 2: 0, 3: 2, 4: 0 } });
    const storyReport = await parseReport({ "src/devtools/readLabel.ts": { 1: 0, 2: 0, 3: 0, 4: 5 } });

    expect(mergeLineCoverage([unitReport, browserReport, storyReport])).toEqual([
      { coveredLineCount: 3, lineCount: 4, path: "src/devtools/readLabel.ts", uncoveredLines: [2] },
    ]);
  });

  test("keeps a line that only one report measured, and a file that only one report has", async () => {
    const unitReport = await parseReport({
      "scripts/demo/createCaptions.ts": { 4: 1, 9: 0 },
      "src/devtools/readLabel.ts": { 1: 1, 7: 0 },
    });
    const storyReport = await parseReport({
      "src/components/ui/Badge.tsx": { 3: 1 },
      "src/devtools/readLabel.ts": { 1: 0, 5: 1 },
    });

    expect(mergeLineCoverage([unitReport, storyReport])).toEqual([
      { coveredLineCount: 1, lineCount: 2, path: "scripts/demo/createCaptions.ts", uncoveredLines: [9] },
      { coveredLineCount: 1, lineCount: 1, path: "src/components/ui/Badge.tsx", uncoveredLines: [] },
      { coveredLineCount: 2, lineCount: 3, path: "src/devtools/readLabel.ts", uncoveredLines: [7] },
    ]);
  });

  test("leaves out tests, stories, test support, other packages, and files without a measured line", async () => {
    const report = await parseReport({
      "../design/src/constants.ts": { 1: 1 },
      ".storybook/preview.tsx": { 1: 1 },
      "scripts/demo/__tests__/createCaptions.test.ts": { 1: 1 },
      "src/devtools/features/minimap/__tests__/helpers.ts": { 1: 1 },
      "src/devtools/features/minimap/components/stories/LogMinimap.stories.tsx": { 1: 1 },
      "src/devtools/features/minimap/components/stories/fixtures.ts": { 1: 1 },
      "src/devtools/features/minimap/types.ts": {},
      "src/devtools/features/minimap/hooks/useServiceLogs.ts": { 1: 1 },
      "test-support/hostPageUtils.ts": { 1: 1 },
    });

    expect(mergeLineCoverage([report]).map((file) => file.path)).toEqual([
      "src/devtools/features/minimap/hooks/useServiceLogs.ts",
    ]);
  });
});
