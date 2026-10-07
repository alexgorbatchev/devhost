import type { IFileLineCoverage, ILineCoverageTotals } from "./types";

const fileHeading: string = "File";
const totalLabel: string = "All files";
const percentageHeading: string = "% Lines";
const uncoveredHeading: string = "Uncovered lines";

/** One table for the package: the total first, then every file with the lines no test ran. */
export function formatLineCoverageTable(files: readonly IFileLineCoverage[], totals: ILineCoverageTotals): string {
  const pathWidth: number = Math.max(
    fileHeading.length,
    totalLabel.length,
    ...files.map((file: IFileLineCoverage): number => file.path.length),
  );
  const formatRow = (path: string, percentage: string, uncoveredLines: string): string => {
    return `${path.padEnd(pathWidth)} | ${percentage.padStart(percentageHeading.length)} | ${uncoveredLines}`.trimEnd();
  };

  return [
    formatRow(fileHeading, percentageHeading, uncoveredHeading),
    `${"-".repeat(pathWidth + 1)}|${"-".repeat(percentageHeading.length + 2)}|${"-".repeat(uncoveredHeading.length + 1)}`,
    formatRow(totalLabel, totals.percentage.toFixed(2), ""),
    ...files.map((file: IFileLineCoverage): string => {
      const percentage: number = (file.coveredLineCount / file.lineCount) * 100;

      return formatRow(file.path, percentage.toFixed(2), formatLineRanges(file.uncoveredLines));
    }),
  ].join("\n");
}

/** Writes ascending line numbers as ranges: `2-4,9`. */
function formatLineRanges(lines: readonly number[]): string {
  const ranges: number[][] = [];

  for (const line of lines) {
    const currentRange: number[] | undefined = ranges.at(-1);

    if (currentRange !== undefined && currentRange.at(-1) === line - 1) {
      currentRange.push(line);
    } else {
      ranges.push([line]);
    }
  }

  return ranges
    .map((range: number[]): string => (range.length === 1 ? String(range[0]) : `${range[0]}-${range.at(-1)}`))
    .join(",");
}
