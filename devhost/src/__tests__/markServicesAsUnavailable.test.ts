import { describe, expect, test } from "bun:test";

import { markServicesAsUnavailable } from "../markServicesAsUnavailable";

describe("markServicesAsUnavailable", () => {
  test("marks every known service as unavailable", () => {
    expect(
      markServicesAsUnavailable([
        {
          name: "devhost",
          status: true,
        },
        {
          name: "api",
          status: true,
        },
        {
          name: "worker",
          status: false,
        },
      ]),
    ).toEqual([
      {
        name: "devhost",
        status: false,
      },
      {
        name: "api",
        status: false,
      },
      {
        name: "worker",
        status: false,
      },
    ]);
  });

  test("falls back to a synthetic devhost entry when no services have been received yet", () => {
    expect(markServicesAsUnavailable([])).toEqual([
      {
        name: "devhost",
        status: false,
      },
    ]);
  });
});
