import { afterEach, describe, expect, test } from "bun:test";

import {
  listAnnotationSelectionPlugins,
  readActiveAnnotationSelectionPlugin,
  registerAnnotationSelectionPlugin,
  unregisterAnnotationSelectionPlugin,
} from "../annotationSelectionPluginRegistry";
import type { IAnnotationSelectionPlugin } from "../annotationSelectionPluginTypes";

afterEach(() => {
  for (const pluginId of listAnnotationSelectionPlugins()
    .filter((plugin) => plugin.id !== "dom-elements")
    .map((plugin) => {
      return plugin.id;
    })) {
    unregisterAnnotationSelectionPlugin(pluginId);
  }
});

describe("annotationSelectionPluginRegistry", () => {
  test("keeps the DOM selector plugin registered by default", () => {
    expect(listAnnotationSelectionPlugins().some((plugin) => plugin.id === "dom-elements")).toBe(true);
    expect(readActiveAnnotationSelectionPlugin().id).toBe("dom-elements");
  });

  test("prefers the highest-priority matching plugin", () => {
    const removePlugin = registerAnnotationSelectionPlugin(
      createPlugin({ id: "host-plugin", matches: () => true, priority: 100 }),
    );

    expect(readActiveAnnotationSelectionPlugin().id).toBe("host-plugin");

    removePlugin();
    expect(readActiveAnnotationSelectionPlugin().id).toBe("dom-elements");
  });

  test("falls back to the DOM selector when custom plugins do not match", () => {
    registerAnnotationSelectionPlugin(createPlugin({ id: "inactive-plugin", matches: () => false, priority: 100 }));

    expect(readActiveAnnotationSelectionPlugin().id).toBe("dom-elements");
  });
});

function createPlugin(overrides: Partial<IAnnotationSelectionPlugin>): IAnnotationSelectionPlugin {
  return {
    id: overrides.id ?? "test-plugin",
    label: overrides.label ?? "Test plugin",
    matches: overrides.matches,
    priority: overrides.priority,
    resolveCandidate: overrides.resolveCandidate ?? (() => null),
  };
}
