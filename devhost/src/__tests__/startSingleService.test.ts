import { describe, expect, test } from "bun:test";

import type { ISingleServiceCommandLineArguments } from "../parseCommandLineArguments";
import { createSingleServiceEnvironment } from "../startSingleService";

describe("createSingleServiceEnvironment", () => {
  test("injects bind host, routed host, and port without HOST", () => {
    const arguments_: ISingleServiceCommandLineArguments = {
      command: ["bun", "run", "dev"],
      host: "hello.xcv.lol",
      port: 3200,
      type: "single-service",
    };

    expect(createSingleServiceEnvironment(arguments_)).toEqual({
      DEVHOST_BIND_HOST: "127.0.0.1",
      DEVHOST_HOST: "hello.xcv.lol",
      PORT: "3200",
    });
  });
});
