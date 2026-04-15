import { describe, expect, test } from "bun:test";

import { createConfiguredDevtoolsScript } from "../createConfiguredDevtoolsScript";

describe("createConfiguredDevtoolsScript", () => {
  test("prepends the injected devtools position config", () => {
    const configuredScript: string = createConfiguredDevtoolsScript(
      "console.log('hello');",
      "top-right",
      "right",
      "cursor",
      "/tmp/project",
      "hello-stack",
      "Claude Code",
      "control-token",
    );

    const expectedInjectedConfigPrefix: string =
      "globalThis.__DEVHOST_INJECTED_CONFIG__={" +
      '"agentDisplayName":"Claude Code",' +
      '"componentEditor":"cursor",' +
      '"controlToken":"control-token",' +
      '"minimapPosition":"right",' +
      '"position":"top-right",' +
      '"projectRootPath":"/tmp/project",' +
      '"stackName":"hello-stack",' +
      '"editorEnabled":true,' +
      '"externalToolbarsEnabled":true,' +
      '"minimapEnabled":true,' +
      '"statusEnabled":true,' +
      '"routedServices":[]};\n';

    expect(configuredScript).toBe(expectedInjectedConfigPrefix + "console.log('hello');");
  });
});
