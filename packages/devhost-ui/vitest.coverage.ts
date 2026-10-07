import type { CoverageOptions } from "vitest/node";

type CoverageRunName = "browser" | "stories";

/**
 * How a Chromium test run measures coverage. Each run writes an LCOV report for the same set of source files, and
 * `scripts/lineCoverage/reportCoverage.ts` merges those with the report of `bun test` into the package's one table.
 */
export function createCoverageOptions(runName: CoverageRunName): CoverageOptions {
  return {
    exclude: ["**/__tests__/**", "**/stories/**"],
    include: ["src/**/*.{ts,tsx}"],
    provider: "v8",
    reporter: ["lcovonly"],
    reportsDirectory: `./.cache/coverage/${runName}`,
  };
}
