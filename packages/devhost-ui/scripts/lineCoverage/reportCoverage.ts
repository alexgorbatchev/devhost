import { parseArgs } from "node:util";

import { lcovParser, type SectionSummary } from "@friedemannsommer/lcov-parser";

import { formatLineCoverageTable } from "./formatLineCoverageTable";
import { mergeLineCoverage } from "./mergeLineCoverage";
import { readLineCoverageTotals } from "./readLineCoverageTotals";
import type { IFileLineCoverage, ILineCoverageTotals } from "./types";

// Merges the LCOV reports of the package's test runs into one line-coverage table and fails when the total is below
// the floor:
//
//   bun scripts/lineCoverage/reportCoverage.ts --minimum-line-coverage 80 <lcov.info>...

const { positionals: reportPaths, values } = parseArgs({
  allowPositionals: true,
  args: Bun.argv.slice(2),
  options: { "minimum-line-coverage": { type: "string" } },
});
const minimumLineCoverage: number = Number(values["minimum-line-coverage"]);

if (
  values["minimum-line-coverage"] === undefined ||
  Number.isNaN(minimumLineCoverage) ||
  minimumLineCoverage < 0 ||
  minimumLineCoverage > 100 ||
  reportPaths.length === 0
) {
  console.error("Usage: bun scripts/lineCoverage/reportCoverage.ts --minimum-line-coverage <0-100> <lcov.info>...");
  process.exit(2);
}

const reports: SectionSummary[][] = [];

for (const reportPath of reportPaths) {
  const reportFile = Bun.file(reportPath);

  // A missing report would otherwise count every file its run covers as untested, or as not existing at all.
  if (!(await reportFile.exists())) {
    console.error(`Coverage report ${reportPath} does not exist. Run that test suite with coverage first.`);
    process.exit(1);
  }

  reports.push(await lcovParser({ from: await reportFile.text() }));
}

const files: IFileLineCoverage[] = mergeLineCoverage(reports);
const totals: ILineCoverageTotals = readLineCoverageTotals(files);

console.log(formatLineCoverageTable(files, totals));

if (totals.percentage < minimumLineCoverage) {
  console.error(
    `\nLine coverage ${totals.percentage.toFixed(2)}% is below the floor of ${minimumLineCoverage.toFixed(2)}%.`,
  );
  process.exit(1);
}
