import { afterEach, describe, expect, test } from "bun:test";
import { DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME } from "../constants";
import { readInjectedDevtoolsConfig } from "../readInjectedDevtoolsConfig";

const original: unknown = Reflect.get(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME);
afterEach(() => {
  Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, original);
});

describe("readInjectedDevtoolsConfig", () => {
  test("keeps chat and capture off without server configuration", () => {
    Reflect.deleteProperty(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME);
    const config = readInjectedDevtoolsConfig();
    expect(config.chatEnabled).toBe(false);
    expect(config.annotationEnabled).toBe(false);
  });
  test.each([
    { chatEnabled: true, annotationEnabled: false },
    { chatEnabled: false, annotationEnabled: true },
    { chatEnabled: true, annotationEnabled: true },
  ])("reads independent server feature gates: %j", (gates) => {
    Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, gates);
    expect(readInjectedDevtoolsConfig()).toMatchObject(gates);
  });
  test("ignores malformed flags and obsolete adapter metadata", () => {
    Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, {
      chatEnabled: "yes",
      annotationEnabled: 1,
      annotationActions: [{ id: "agent", kind: "agent", label: "Legacy", queueEnabled: true }],
      annotationDefaultActionId: "agent",
      annotationQueueEnabled: true,
      terminalEnabled: true,
    });
    const config = readInjectedDevtoolsConfig();
    expect(config.chatEnabled).toBe(false);
    expect(config.annotationEnabled).toBe(false);
    for (const key of ["annotationActions", "annotationDefaultActionId", "annotationQueueEnabled", "terminalEnabled"])
      expect(Reflect.has(config, key)).toBe(false);
  });
  test("turns the config editor on only when the server says so", () => {
    Reflect.deleteProperty(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME);
    expect(readInjectedDevtoolsConfig().configEditorEnabled).toBe(false);
    Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, { configEditorEnabled: true });
    expect(readInjectedDevtoolsConfig().configEditorEnabled).toBe(true);
    Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, { configEditorEnabled: "yes" });
    expect(readInjectedDevtoolsConfig().configEditorEnabled).toBe(false);
  });
  test("reads external editor, checkout, home and routed service metadata", () => {
    Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, {
      componentEditor: "cursor",
      projectRootPath: "/workspaces/shop",
      homeDirectoryPath: "/home/alex",
      stackName: "shop",
      position: "top-right",
      resourcesEnabled: true,
      primaryService: "web",
      routedServices: [
        { host: "shop.localhost", path: "/*", serviceName: "web" },
        { host: 3, path: "/", serviceName: "invalid" },
      ],
    });
    expect(readInjectedDevtoolsConfig()).toMatchObject({
      componentEditor: "cursor",
      projectRootPath: "/workspaces/shop",
      homeDirectoryPath: "/home/alex",
      stackName: "shop",
      position: "top-right",
      resourcesEnabled: true,
      primaryService: "web",
      routedServices: [{ host: "shop.localhost", path: "/", serviceName: "web" }],
    });
  });
  test("falls back for removed Vim launching and invalid presentation fields", () => {
    Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, {
      componentEditor: "neovim",
      homeDirectoryPath: 42,
      position: "top-left",
      resourcesEnabled: "yes",
    });
    expect(readInjectedDevtoolsConfig()).toMatchObject({
      componentEditor: "vscode",
      homeDirectoryPath: "",
      position: "bottom-right",
      resourcesEnabled: false,
    });
  });
  test("preserves only a valid native browser instance identity", () => {
    Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, {
      nativeBrowserConfigured: true,
      nativeBrowserInstanceId: "a".repeat(32),
    });
    expect(readInjectedDevtoolsConfig()).toMatchObject({
      nativeBrowserConfigured: true,
      nativeBrowserInstanceId: "a".repeat(32),
    });
    Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, { nativeBrowserInstanceId: "invalid" });
    expect(readInjectedDevtoolsConfig().nativeBrowserInstanceId).toBe("");
  });
  test("reuses parsed routing until the injected object is replaced", () => {
    Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, {
      homeDirectoryPath: "/home/first",
      routedServices: [{ host: "shop.localhost", path: "/", serviceName: "web" }],
    });
    const first = readInjectedDevtoolsConfig();
    expect(readInjectedDevtoolsConfig()).toBe(first);
    expect(readInjectedDevtoolsConfig().routedServices).toBe(first.routedServices);
    Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, { homeDirectoryPath: "/home/second" });
    expect(first.homeDirectoryPath).toBe("/home/first");
    expect(readInjectedDevtoolsConfig().homeDirectoryPath).toBe("/home/second");
  });
});
