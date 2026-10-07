import { describe, expect, test } from "bun:test";

import { readLineCoverageTotals } from "../readLineCoverageTotals";

describe("readLineCoverageTotals", () => {
  test("adds up the lines of every file", () => {
    expect(
      readLineCoverageTotals([
        { coveredLineCount: 4, lineCount: 4, path: "src/components/ui/Badge.tsx", uncoveredLines: [] },
        {
          coveredLineCount: 3,
          lineCount: 10,
          path: "src/devtools/readLabel.ts",
          uncoveredLines: [2, 3, 4, 9, 12, 13, 20],
        },
        { coveredLineCount: 0, lineCount: 2, path: "scripts/demo/createCaptions.ts", uncoveredLines: [5, 6] },
      ]),
    ).toEqual({ coveredLineCount: 7, lineCount: 16, percentage: 43.75 });
  });

  test("reports nothing measured as fully covered", () => {
    expect(readLineCoverageTotals([])).toEqual({ coveredLineCount: 0, lineCount: 0, percentage: 100 });
  });
});
