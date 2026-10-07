import type { IFileLineCoverage, ILineCoverageTotals } from "./types";

export function readLineCoverageTotals(files: readonly IFileLineCoverage[]): ILineCoverageTotals {
  const coveredLineCount: number = files.reduce(
    (sum: number, file: IFileLineCoverage) => sum + file.coveredLineCount,
    0,
  );
  const lineCount: number = files.reduce((sum: number, file: IFileLineCoverage) => sum + file.lineCount, 0);

  return {
    coveredLineCount,
    lineCount,
    percentage: lineCount === 0 ? 100 : (coveredLineCount / lineCount) * 100,
  };
}
