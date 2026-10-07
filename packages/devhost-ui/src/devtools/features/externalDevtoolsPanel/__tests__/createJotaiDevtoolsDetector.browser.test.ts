import { assert, describe, expect, test } from "vitest";

import { createJotaiDevtoolsDetector } from "../createJotaiDevtoolsDetector";
import { factory_jotaiInspector } from "./fixtures/fixtures";

describe("createJotaiDevtoolsDetector", () => {
  test("targets each persistent native root across open state and document reordering", () => {
    const first = factory_jotaiInspector();
    const second = factory_jotaiInspector();

    document.body.append(first.root, second.root);

    const read = createJotaiDevtoolsDetector(document);
    const [firstAdapter, secondAdapter] = read();
    assert(firstAdapter !== undefined && secondAdapter !== undefined);
    firstAdapter.open();
    expect(firstAdapter.isOpen()).toBe(true);
    expect(secondAdapter.isOpen()).toBe(false);
    document.body.append(first.root);
    expect(read().map((adapter) => adapter.id)).toEqual(["jotai-2", "jotai-1"]);
    secondAdapter.open();
    firstAdapter.close();
    expect(firstAdapter.isOpen()).toBe(false);
    expect(secondAdapter.isOpen()).toBe(true);
    expect(first.readOpenCount()).toBe(1);
    expect(first.readCloseCount()).toBe(1);
    expect(second.readOpenCount()).toBe(1);
    expect(second.readCloseCount()).toBe(0);
  });

  test("requeries replaced launchers and gives remounted roots new identities", () => {
    const original = factory_jotaiInspector();
    const replacement = factory_jotaiInspector();

    document.body.append(original.root);

    const read = createJotaiDevtoolsDetector(document);
    const [removed] = read();
    assert(removed !== undefined);
    const readNewLauncherOpenCount = original.replaceLauncher();
    removed.open();
    expect(readNewLauncherOpenCount()).toBe(1);
    expect(original.readOpenCount()).toBe(0);
    original.root.replaceWith(replacement.root);
    const [current] = read();
    assert(current !== undefined);
    expect(current.id).toBe("jotai-2");
    removed.open();
    removed.close();
    current.open();
    expect(current.isOpen()).toBe(true);
    expect(removed.isInstalled()).toBe(false);
    expect(removed.isOpen()).toBe(false);
    expect(replacement.readOpenCount()).toBe(1);
    expect(replacement.readCloseCount()).toBe(0);
    expect(readNewLauncherOpenCount()).toBe(1);
    expect(original.readCloseCount()).toBe(0);
  });

  test("ignores unrelated roots while discovering the real inspector", () => {
    const unrelated = factory_jotaiInspector(false);
    const native = factory_jotaiInspector();

    document.body.append(unrelated.root, native.root);

    const adapters = createJotaiDevtoolsDetector(document)();
    expect(adapters).toHaveLength(1);
    const [adapter] = adapters;
    assert(adapter !== undefined);
    adapter.open();
    expect(adapter.isInstalled()).toBe(true);
    expect(adapter.isOpen()).toBe(true);
    expect(native.readOpenCount()).toBe(1);
    expect(unrelated.readOpenCount()).toBe(0);
  });
});
