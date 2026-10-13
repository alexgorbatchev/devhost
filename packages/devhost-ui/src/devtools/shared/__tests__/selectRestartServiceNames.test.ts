import { describe, expect, test } from "bun:test";

import { selectRestartServiceNames } from "../selectRestartServiceNames";

describe("selectRestartServiceNames", () => {
  test("selects every changed service while leaving unchanged services running", () => {
    expect(
      selectRestartServiceNames(
        [
          { name: "api", managed: true, status: true, dirty: true },
          { name: "worker", managed: true, status: true },
          { name: "web", managed: true, status: true, dirty: true },
        ],
        "worker",
      ),
    ).toEqual(["api", "web"]);
  });

  test("falls back to the primary service when nothing changed", () => {
    expect(selectRestartServiceNames([{ name: "web", managed: true, status: true }], "web")).toEqual(["web"]);
  });

  test("does nothing without changed services or a primary service", () => {
    expect(selectRestartServiceNames([], undefined)).toEqual([]);
  });

  test("blocks the command while any service is restarting", () => {
    expect(
      selectRestartServiceNames(
        [
          { name: "api", managed: true, status: true, dirty: true },
          { name: "web", managed: true, status: true, restarting: true },
        ],
        "api",
      ),
    ).toEqual([]);
  });
});
