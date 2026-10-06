import { afterEach, describe, expect, test } from "bun:test";

import { DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME } from "../constants";
import { readInjectedDevtoolsConfig } from "../readInjectedDevtoolsConfig";

const originalInjectedConfig: unknown = Reflect.get(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME);

afterEach(() => {
  Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, originalInjectedConfig);
});

describe("readInjectedDevtoolsConfig", () => {
  test("reads the home directory for path display", () => {
    Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, { homeDirectoryPath: "/home/alex" });
    expect(readInjectedDevtoolsConfig().homeDirectoryPath).toBe("/home/alex");
  });

  test("ignores an invalid home directory", () => {
    Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, { homeDirectoryPath: 42 });
    expect(readInjectedDevtoolsConfig().homeDirectoryPath).toBe("");
  });

  test("returns defaults when the injected config is unavailable", () => {
    Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, undefined);

    expect(readInjectedDevtoolsConfig()).toEqual({
      nativeBrowserConfigured: false,
      nativeBrowserInstanceId: "",
      annotationActions: [],
      annotationDefaultActionId: "",
      componentEditor: "vscode",
      homeDirectoryPath: "",
      position: "bottom-right",
      projectRootPath: "",
      routedServices: [],
      stackName: "devhost",
      annotationEnabled: false,
      annotationQueueEnabled: false,
      editorEnabled: true,
      externalToolbarsEnabled: true,
      minimapEnabled: true,
      statusEnabled: true,
      terminalEnabled: true,
      restartServicesShortcut: "alt+ctrl+r",
      primaryService: "",
    });
  });

  test("reads the injected editor and project-root config", () => {
    Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, {
      annotationActions: [{ id: "agent", kind: "agent", label: "Claude Code", queueEnabled: true }],
      annotationDefaultActionId: "agent",
      componentEditor: "neovim",
      homeDirectoryPath: "",
      position: "top-right",
      projectRootPath: "/tmp/project",
      routedServices: [{ host: "app.localhost", path: "/api/*", serviceName: "api" }],
      stackName: "hello-stack",
    });

    expect(readInjectedDevtoolsConfig()).toEqual({
      nativeBrowserConfigured: false,
      nativeBrowserInstanceId: "",
      annotationActions: [{ id: "agent", kind: "agent", label: "Claude Code", queueEnabled: true }],
      annotationDefaultActionId: "agent",
      componentEditor: "neovim",
      homeDirectoryPath: "",
      position: "top-right",
      projectRootPath: "/tmp/project",
      routedServices: [{ host: "app.localhost", path: "/api/*", serviceName: "api" }],
      stackName: "hello-stack",
      annotationEnabled: true,
      annotationQueueEnabled: true,
      editorEnabled: true,
      externalToolbarsEnabled: true,
      minimapEnabled: true,
      statusEnabled: true,
      terminalEnabled: true,
      restartServicesShortcut: "alt+ctrl+r",
      primaryService: "",
    });
  });

  test("falls back to the default status position for removed left-side values", () => {
    Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, {
      position: "top-left",
    });

    expect(readInjectedDevtoolsConfig()).toEqual({
      nativeBrowserConfigured: false,
      nativeBrowserInstanceId: "",
      annotationActions: [],
      annotationDefaultActionId: "",
      componentEditor: "vscode",
      homeDirectoryPath: "",
      position: "bottom-right",
      projectRootPath: "",
      routedServices: [],
      stackName: "devhost",
      annotationEnabled: false,
      annotationQueueEnabled: false,
      editorEnabled: true,
      externalToolbarsEnabled: true,
      minimapEnabled: true,
      statusEnabled: true,
      terminalEnabled: true,
      restartServicesShortcut: "alt+ctrl+r",
      primaryService: "",
    });
  });

  test("reads capability gates from the injected config", () => {
    Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, {
      annotationEnabled: false,
      annotationQueueEnabled: false,
      terminalEnabled: false,
    });

    expect(readInjectedDevtoolsConfig()).toEqual({
      nativeBrowserConfigured: false,
      nativeBrowserInstanceId: "",
      annotationActions: [],
      annotationDefaultActionId: "",
      componentEditor: "vscode",
      homeDirectoryPath: "",
      position: "bottom-right",
      projectRootPath: "",
      routedServices: [],
      stackName: "devhost",
      annotationEnabled: false,
      annotationQueueEnabled: false,
      editorEnabled: true,
      externalToolbarsEnabled: true,
      minimapEnabled: true,
      statusEnabled: true,
      terminalEnabled: false,
      restartServicesShortcut: "alt+ctrl+r",
      primaryService: "",
    });
  });

  test("reads annotation actions from the injected config", () => {
    Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, {
      annotationActions: [
        { id: "ask-agent", kind: "agent", label: "Pi", queueEnabled: true },
        { id: "create-ticket", kind: "command", label: "Create Ticket", queueEnabled: false },
      ],
      annotationDefaultActionId: "create-ticket",
    });

    expect(readInjectedDevtoolsConfig()).toEqual({
      nativeBrowserConfigured: false,
      nativeBrowserInstanceId: "",
      annotationActions: [
        { id: "ask-agent", kind: "agent", label: "Pi", queueEnabled: true },
        { id: "create-ticket", kind: "command", label: "Create Ticket", queueEnabled: false },
      ],
      annotationDefaultActionId: "create-ticket",
      componentEditor: "vscode",
      homeDirectoryPath: "",
      position: "bottom-right",
      projectRootPath: "",
      routedServices: [],
      stackName: "devhost",
      annotationEnabled: true,
      annotationQueueEnabled: true,
      editorEnabled: true,
      externalToolbarsEnabled: true,
      minimapEnabled: true,
      statusEnabled: true,
      terminalEnabled: true,
      restartServicesShortcut: "alt+ctrl+r",
      primaryService: "",
    });
  });

  test("returns the same configuration while the injected object is unchanged", () => {
    Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, {
      annotationActions: [{ id: "agent", kind: "agent", label: "Pi", queueEnabled: true }],
      routedServices: [{ host: "app.localhost", path: "/", serviceName: "web" }],
    });

    const firstRead = readInjectedDevtoolsConfig();
    const secondRead = readInjectedDevtoolsConfig();

    // Components read the configuration during render; a new object or array each time would retrigger every
    // effect and callback that depends on it.
    expect(secondRead).toBe(firstRead);
    expect(secondRead.annotationActions).toBe(firstRead.annotationActions);
    expect(secondRead.routedServices).toBe(firstRead.routedServices);
  });

  test("reads again when the injected object is replaced", () => {
    Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, { homeDirectoryPath: "/home/first" });
    const firstRead = readInjectedDevtoolsConfig();

    Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, { homeDirectoryPath: "/home/second" });

    expect(firstRead.homeDirectoryPath).toBe("/home/first");
    expect(readInjectedDevtoolsConfig().homeDirectoryPath).toBe("/home/second");
  });
});
