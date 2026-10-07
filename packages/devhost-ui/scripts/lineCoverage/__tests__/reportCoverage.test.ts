import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

interface IReportRun {
  exitCode: number;
  stderr: string;
  stdout: string;
}

const reportScriptPath: string = join(import.meta.dir, "../reportCoverage.ts");
let reportsPath: string;

async function runReport(...args: string[]): Promise<IReportRun> {
  const run = Bun.spawn(["bun", reportScriptPath, ...args], { cwd: reportsPath, stderr: "pipe", stdout: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    run.exited,
    new Response(run.stdout).text(),
    new Response(run.stderr).text(),
  ]);

  return { exitCode, stderr, stdout };
}

beforeAll(async () => {
  reportsPath = await mkdtemp(join(tmpdir(), "devhost-ui-coverage-"));
  // Two runs that each cover a different half of one file, and a file only the second run loads.
  await Bun.write(
    join(reportsPath, "unit.info"),
    "SF:src/devtools/readLabel.ts\nDA:1,1\nDA:2,1\nDA:3,0\nDA:4,0\nend_of_record\n",
  );
  await Bun.write(
    join(reportsPath, "stories.info"),
    [
      "SF:src/devtools/readLabel.ts\nDA:1,0\nDA:2,0\nDA:3,3\nDA:4,0\nend_of_record",
      "SF:src/components/ui/Badge.tsx\nDA:1,1\nDA:2,1\nDA:3,1\nDA:4,1\nend_of_record\n",
    ].join("\n"),
  );
});

afterAll(async () => {
  await rm(reportsPath, { force: true, recursive: true });
});

describe("reportCoverage", () => {
  test("prints one table for every report and passes at the floor", async () => {
    expect(await runReport("--minimum-line-coverage", "87.5", "unit.info", "stories.info")).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: [
        "File                        | % Lines | Uncovered lines",
        "----------------------------|---------|----------------",
        "All files                   |   87.50 |",
        "src/components/ui/Badge.tsx |  100.00 |",
        "src/devtools/readLabel.ts   |   75.00 | 4",
        "",
      ].join("\n"),
    });
  });

  test("fails when the merged coverage is below the floor", async () => {
    const run: IReportRun = await runReport("--minimum-line-coverage", "87.51", "unit.info", "stories.info");

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toBe("\nLine coverage 87.50% is below the floor of 87.51%.\n");
  });

  test("fails when a report is missing instead of reporting what is left", async () => {
    expect(await runReport("--minimum-line-coverage", "0", "unit.info", "browser.info")).toEqual({
      exitCode: 1,
      stderr: "Coverage report browser.info does not exist. Run that test suite with coverage first.\n",
      stdout: "",
    });
  });

  test.each([
    ["no floor", ["unit.info"]],
    ["a floor that is not a percentage", ["--minimum-line-coverage", "most", "unit.info"]],
    ["a floor above 100", ["--minimum-line-coverage", "101", "unit.info"]],
    ["no report", ["--minimum-line-coverage", "80"]],
  ])("explains its usage when given %s", async (_case: string, args: string[]) => {
    expect(await runReport(...args)).toEqual({
      exitCode: 2,
      stderr: "Usage: bun scripts/lineCoverage/reportCoverage.ts --minimum-line-coverage <0-100> <lcov.info>...\n",
      stdout: "",
    });
  });
});
