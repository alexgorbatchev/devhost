import { describe, expect, test } from "bun:test";

import { createConfiguredDevtoolsScript } from "../createConfiguredDevtoolsScript";

describe("createConfiguredDevtoolsScript", () => {
  test("prepends the injected devtools position config", () => {
    const configuredScript: string = createConfiguredDevtoolsScript(
      "console.log('hello');",
      "top-left",
      "hello-stack",
    );

    expect(configuredScript).toBe(
      'globalThis.__DEVHOST_INJECTED_CONFIG__={"position":"top-left","stackName":"hello-stack"};\n' +
        "console.log('hello');",
    );
  });
});
