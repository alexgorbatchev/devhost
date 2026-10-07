import type { LineEntry, SectionSummary } from "@friedemannsommer/lcov-parser";

import type { IFileLineCoverage } from "./types";

// A file's coverage is measured only for source the package ships or runs: not for tests, stories, or their support.
const unmeasuredPathPattern: RegExp = /(^|\/)(__tests__|stories|fixtures)\/|\.test\.tsx?$/;
const measuredPathPattern: RegExp = /^(src|scripts)\//;

/**
 * Merges the reports of several test runs into one account per source file. The runners cover different code, so a
 * line counts as covered when any report saw it run. The runners also disagree slightly about which lines of a file
 * can run at all; a line any of them measured is counted.
 *
 * Only line coverage can be merged this way: the runners count functions and branches differently.
 */
export function mergeLineCoverage(reports: readonly SectionSummary[][]): IFileLineCoverage[] {
  const lineHitsByPath = new Map<string, Map<number, number>>();

  for (const section of reports.flat()) {
    if (!measuredPathPattern.test(section.path) || unmeasuredPathPattern.test(section.path)) {
      continue;
    }

    const lineHits: Map<number, number> = lineHitsByPath.get(section.path) ?? new Map<number, number>();

    lineHitsByPath.set(section.path, lineHits);
    for (const { hit, line } of section.lines.details) {
      lineHits.set(line, (lineHits.get(line) ?? 0) + hit);
    }
  }

  return [...lineHitsByPath]
    .filter(([, lineHits]): boolean => lineHits.size > 0)
    .map(([path, lineHits]): IFileLineCoverage => {
      const uncoveredLines: number[] = [...lineHits]
        .filter(([, hit]): boolean => hit === 0)
        .map(([line]): LineEntry["line"] => line)
        .sort((left: number, right: number): number => left - right);

      return {
        coveredLineCount: lineHits.size - uncoveredLines.length,
        lineCount: lineHits.size,
        path,
        uncoveredLines,
      };
    })
    .sort((left: IFileLineCoverage, right: IFileLineCoverage): number => left.path.localeCompare(right.path));
}
