import { describe, expect, test } from "bun:test";

import { markServicesAsUnavailable } from "../markServicesAsUnavailable";

describe("markServicesAsUnavailable", () => {
  test("marks every known service as unavailable", () => {
    expect(
      markServicesAsUnavailable(
        [
          {
            managed: true,
            name: "hello-stack",
            status: true,
            url: "https://hello.localhost/",
          },
          {
            managed: false,
            name: "api",
            status: true,
            url: "https://hello.localhost/api/",
          },
          {
            managed: true,
            name: "worker",
            status: false,
          },
        ],
        "hello-stack",
      ),
    ).toEqual([
      {
        managed: true,
        name: "hello-stack",
        status: false,
        url: "https://hello.localhost/",
      },
      {
        managed: false,
        name: "api",
        status: false,
        url: "https://hello.localhost/api/",
      },
      {
        managed: true,
        name: "worker",
        status: false,
      },
    ]);
  });

  test("falls back to the configured stack name when no services have been received yet", () => {
    expect(markServicesAsUnavailable([], "hello-stack")).toEqual([
      {
        managed: false,
        name: "hello-stack",
        status: false,
      },
    ]);
  });
});
