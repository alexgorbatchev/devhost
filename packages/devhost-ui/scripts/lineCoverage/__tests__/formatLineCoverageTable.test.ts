import { describe, expect, test } from "bun:test";

import { formatLineCoverageTable } from "../formatLineCoverageTable";
import type { IFileLineCoverage } from "../types";

describe("formatLineCoverageTable", () => {
  test("lists the total and every file with its uncovered lines as ranges", () => {
    const files: IFileLineCoverage[] = [
      { coveredLineCount: 4, lineCount: 4, path: "src/components/ui/Badge.tsx", uncoveredLines: [] },
      {
        coveredLineCount: 3,
        lineCount: 10,
        path: "src/devtools/readLabel.ts",
        uncoveredLines: [2, 3, 4, 9, 12, 13, 20],
      },
      { coveredLineCount: 0, lineCount: 2, path: "scripts/demo/createCaptions.ts", uncoveredLines: [5, 6] },
    ];

    expect(formatLineCoverageTable(files, { coveredLineCount: 7, lineCount: 16, percentage: 43.75 }))
      .toMatchInlineSnapshot(`
      "File                           | % Lines | Uncovered lines
      -------------------------------|---------|----------------
      All files                      |   43.75 |
      src/components/ui/Badge.tsx    |  100.00 |
      src/devtools/readLabel.ts      |   30.00 | 2-4,9,12-13,20
      scripts/demo/createCaptions.ts |    0.00 | 5-6"
    `);
  });
});
