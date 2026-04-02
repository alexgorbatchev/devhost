import { describe, expect, test } from "bun:test";

import { selectVisibleServices } from "../devtools/features/serviceStatusPanel/selectVisibleServices";

describe("selectVisibleServices", () => {
  test("returns an empty list when there are no services", () => {
    expect(selectVisibleServices([])).toEqual([]);
  });

  test("returns only the stack name when every service is healthy", () => {
    expect(
      selectVisibleServices([
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
          status: true,
        },
      ]),
    ).toEqual([
      {
        name: "hello-stack",
        status: true,
      },
    ]);
  });

  test("returns only the unhealthy services when any service is unhealthy", () => {
    expect(
      selectVisibleServices([
        {
          name: "hello-stack",
          status: true,
        },
        {
          name: "api",
          status: false,
        },
        {
          name: "worker",
          status: true,
        },
        {
          name: "db",
          status: false,
        },
      ]),
    ).toEqual([
      {
        name: "api",
        status: false,
      },
      {
        name: "db",
        status: false,
      },
    ]);
  });
});
