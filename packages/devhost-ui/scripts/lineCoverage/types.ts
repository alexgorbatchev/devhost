/** How much of one source file the tests ran, counted in lines. */
export interface IFileLineCoverage {
  coveredLineCount: number;
  /** The lines at least one report measured. */
  lineCount: number;
  /** Relative to the package, as the reports name it. */
  path: string;
  /** Measured lines that no report saw run, in ascending order. */
  uncoveredLines: number[];
}

export interface ILineCoverageTotals {
  coveredLineCount: number;
  lineCount: number;
  /** Covered lines out of measured lines, from 0 to 100. */
  percentage: number;
}
