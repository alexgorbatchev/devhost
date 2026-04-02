import { describe, expect, test } from "bun:test";

import { createConfiguredDevtoolsScript } from "../createConfiguredDevtoolsScript";

describe("createConfiguredDevtoolsScript", () => {
  test("prepends the injected devtools position config", () => {
    const configuredScript: string = createConfiguredDevtoolsScript(
      "console.log('hello');",
      "top-left",
      "left",
      "hello-stack",
      "control-token",
    );

    const expectedInjectedConfigPrefix: string =
      'globalThis.__DEVHOST_INJECTED_CONFIG__={' +
      '"controlToken":"control-token","minimapPosition":"left","position":"top-left","stackName":"hello-stack"};\n';

    expect(configuredScript).toBe(expectedInjectedConfigPrefix + "console.log('hello');");
  });
});
