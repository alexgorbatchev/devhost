import { expect, it, mock } from "bun:test";
import { preparePromoRenderer } from "../preparePromoRenderer";
import type { RunCommand } from "../types";

function createRunner(nodeVersion: string): ReturnType<typeof mock<RunCommand>> {
  // The first command asks Node.js for its version; later ones print nothing the caller reads.
  return mock<RunCommand>().mockResolvedValueOnce(`${nodeVersion}\n`).mockResolvedValue("");
}

it("fetches the renderer's browser through the project's pinned script before anything is captured", async () => {
  const run = createRunner("v24.14.1");
  const signal = new AbortController().signal;

  await preparePromoRenderer(run, "/checkout/promo", "/checkout/.tmp/demos", signal);

  expect(run.mock.calls.map((call) => call[0])).toEqual([
    ["node", "--version"],
    ["bun", "run", "browser"],
  ]);
  const options = run.mock.calls[1]?.[1];
  expect(options?.cwd).toBe("/checkout/promo");
  expect(options?.signal).toBe(signal);
  expect({
    telemetry: options?.env?.HYPERFRAMES_NO_TELEMETRY,
    skills: options?.env?.HYPERFRAMES_SKIP_SKILLS,
    temporary: options?.env?.TMPDIR,
  }).toEqual({ telemetry: "1", skills: "1", temporary: "/checkout/.tmp/demos" });
});

it("stops before the browser download when Node.js is older than the renderer supports", async () => {
  const run = createRunner("v20.11.0");

  await expect(
    preparePromoRenderer(run, "/checkout/promo", "/checkout/.tmp/demos", new AbortController().signal),
  ).rejects.toThrow("The promo's renderer needs Node.js 22 or newer; found v20.11.0");
  expect(run).toHaveBeenCalledTimes(1);
});

it("rejects a Node.js version it cannot read", async () => {
  const run = createRunner("node: command output changed");

  await expect(
    preparePromoRenderer(run, "/checkout/promo", "/checkout/.tmp/demos", new AbortController().signal),
  ).rejects.toThrow("Cannot read the Node.js version from: node: command output changed");
});
