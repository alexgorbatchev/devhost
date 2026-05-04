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
      agentDisplayName: "Pi",
      annotationActions: [{ displayName: "Pi", id: "agent", kind: "agent", queueEnabled: true }],
      annotationDefaultActionId: "agent",
      componentEditor: "vscode",
      controlToken: "",
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
    });
  });

  test("reads the injected editor and project-root config", () => {
    Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, {
      agentDisplayName: "Claude Code",
      annotationActions: [{ displayName: "Claude Code", id: "agent", kind: "agent", queueEnabled: true }],
      annotationDefaultActionId: "agent",
      componentEditor: "neovim",
      controlToken: "control-token",
      position: "top-right",
      projectRootPath: "/tmp/project",
      routedServices: [{ host: "app.localhost", path: "/api/*", serviceName: "api" }],
      stackName: "hello-stack",
    });

    expect(readInjectedDevtoolsConfig()).toEqual({
      agentDisplayName: "Claude Code",
      annotationActions: [{ displayName: "Claude Code", id: "agent", kind: "agent", queueEnabled: true }],
      annotationDefaultActionId: "agent",
      componentEditor: "neovim",
      controlToken: "control-token",
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
    });
  });

  test("falls back to the default status position for removed left-side values", () => {
    Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, {
      position: "top-left",
    });

    expect(readInjectedDevtoolsConfig()).toEqual({
      agentDisplayName: "Pi",
      annotationActions: [{ displayName: "Pi", id: "agent", kind: "agent", queueEnabled: true }],
      annotationDefaultActionId: "agent",
      componentEditor: "vscode",
      controlToken: "",
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
    });
  });

  test("reads capability gates from the injected config", () => {
    Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, {
      annotationEnabled: false,
      annotationQueueEnabled: false,
      terminalEnabled: false,
    });

    expect(readInjectedDevtoolsConfig()).toEqual({
      agentDisplayName: "Pi",
      annotationActions: [{ displayName: "Pi", id: "agent", kind: "agent", queueEnabled: true }],
      annotationDefaultActionId: "agent",
      componentEditor: "vscode",
      controlToken: "",
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
    });
  });

  test("reads annotation actions from the injected config", () => {
    Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, {
      annotationActions: [
        { displayName: "Ask Agent", id: "ask-agent", kind: "agent", queueEnabled: true },
        { displayName: "Create Ticket", id: "create-ticket", kind: "command", queueEnabled: false },
      ],
      annotationDefaultActionId: "create-ticket",
    });

    expect(readInjectedDevtoolsConfig()).toEqual({
      agentDisplayName: "Pi",
      annotationActions: [
        { displayName: "Ask Agent", id: "ask-agent", kind: "agent", queueEnabled: true },
        { displayName: "Create Ticket", id: "create-ticket", kind: "command", queueEnabled: false },
      ],
      annotationDefaultActionId: "create-ticket",
      componentEditor: "vscode",
      controlToken: "",
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
    });
  });
});
