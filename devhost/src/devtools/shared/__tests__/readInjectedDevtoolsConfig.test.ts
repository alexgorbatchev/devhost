import { afterEach, describe, expect, test } from "bun:test";

import { DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME } from "../constants";
import { readInjectedDevtoolsConfig } from "../readInjectedDevtoolsConfig";

const originalInjectedConfig: unknown = Reflect.get(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME);

afterEach(() => {
  Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, originalInjectedConfig);
});

describe("readInjectedDevtoolsConfig", () => {
  test("returns defaults when the injected config is unavailable", () => {
    Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, undefined);

    expect(readInjectedDevtoolsConfig()).toEqual({
      componentEditor: "vscode",
      controlToken: "",
      minimapPosition: "right",
      position: "bottom-right",
      projectRootPath: "",
      stackName: "devhost",
    });
  });

  test("reads the injected editor and project-root config", () => {
    Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, {
      componentEditor: "cursor",
      controlToken: "control-token",
      minimapPosition: "left",
      position: "top-left",
      projectRootPath: "/tmp/project",
      stackName: "hello-stack",
    });

    expect(readInjectedDevtoolsConfig()).toEqual({
      componentEditor: "cursor",
      controlToken: "control-token",
      minimapPosition: "left",
      position: "top-left",
      projectRootPath: "/tmp/project",
      stackName: "hello-stack",
    });
  });
});
