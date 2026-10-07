import assert from "node:assert/strict";
import { describe, expect, test } from "bun:test";

import { createJotaiDevtoolsDetector } from "../createJotaiDevtoolsDetector";
import { factory_jotaiInspector } from "./fixtures/fixtures";

describe("createJotaiDevtoolsDetector", () => {
  test("targets each persistent native root across open state and document reordering", () => {
    const first = factory_jotaiInspector();
    const second = factory_jotaiInspector();
    let roots = [first.root, second.root];
    const read = createJotaiDevtoolsDetector({ querySelectorAll: () => roots } as unknown as Document);
    const [firstAdapter, secondAdapter] = read();
    assert(firstAdapter !== undefined && secondAdapter !== undefined);
    firstAdapter.open();
    expect(firstAdapter.isOpen()).toBe(true);
    expect(secondAdapter.isOpen()).toBe(false);
    roots = [second.root, first.root];
    expect(read().map((adapter) => adapter.id)).toEqual(["jotai-2", "jotai-1"]);
    secondAdapter.open();
    firstAdapter.close();
    expect(firstAdapter.isOpen()).toBe(false);
    expect(secondAdapter.isOpen()).toBe(true);
    expect(first.open).toHaveBeenCalledTimes(1);
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.open).toHaveBeenCalledTimes(1);
    expect(second.close).toHaveBeenCalledTimes(0);
  });

  test("requeries replaced launchers and gives remounted roots new identities", () => {
    const original = factory_jotaiInspector();
    const replacement = factory_jotaiInspector();
    let roots = [original.root];
    const read = createJotaiDevtoolsDetector({ querySelectorAll: () => roots } as unknown as Document);
    const [removed] = read();
    assert(removed !== undefined);
    const newLauncher = original.replaceLauncher();
    removed.open();
    expect(newLauncher).toHaveBeenCalledTimes(1);
    expect(original.open).toHaveBeenCalledTimes(0);
    roots = [replacement.root];
    const [current] = read();
    assert(current !== undefined);
    expect(current.id).toBe("jotai-2");
    removed.open();
    removed.close();
    current.open();
    expect(current.isOpen()).toBe(true);
    expect(removed.isInstalled()).toBe(false);
    expect(removed.isOpen()).toBe(false);
    expect(replacement.open).toHaveBeenCalledTimes(1);
    expect(replacement.close).toHaveBeenCalledTimes(0);
    expect(original.close).toHaveBeenCalledTimes(0);
  });

  test("ignores unrelated roots while discovering the real inspector", () => {
    const unrelated = factory_jotaiInspector(false);
    const native = factory_jotaiInspector();
    const read = createJotaiDevtoolsDetector({
      querySelectorAll: () => [unrelated.root, native.root],
    } as unknown as Document);
    const adapters = read();
    expect(adapters).toHaveLength(1);
    const [adapter] = adapters;
    assert(adapter !== undefined);
    adapter.open();
    expect(adapter.isInstalled()).toBe(true);
    expect(adapter.isOpen()).toBe(true);
    expect(native.open).toHaveBeenCalledTimes(1);
    expect(unrelated.open).toHaveBeenCalledTimes(0);
  });
});
