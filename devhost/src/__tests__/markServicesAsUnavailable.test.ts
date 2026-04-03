import { describe, expect, test } from "bun:test";

import { markServicesAsUnavailable } from "../devtools/features/serviceStatusPanel/markServicesAsUnavailable";

describe("markServicesAsUnavailable", () => {
  test("marks every known service as unavailable", () => {
    expect(
      markServicesAsUnavailable(
        [
          {
            name: "hello-stack",
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
        ],
        "hello-stack",
      ),
    ).toEqual([
      {
        name: "hello-stack",
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

  test("falls back to the configured stack name when no services have been received yet", () => {
    expect(markServicesAsUnavailable([], "hello-stack")).toEqual([
      {
        name: "hello-stack",
        status: false,
      },
    ]);
  });
});
