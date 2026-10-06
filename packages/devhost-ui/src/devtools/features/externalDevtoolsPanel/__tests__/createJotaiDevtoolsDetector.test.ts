import assert from "node:assert/strict";
import { describe, expect, mock, test } from "bun:test";

import { createJotaiDevtoolsDetector } from "../createJotaiDevtoolsDetector";

interface IInspectorFixture {
  root: HTMLElement;
  open: ReturnType<typeof mock>;
  close: ReturnType<typeof mock>;
  replaceLauncher: () => ReturnType<typeof mock>;
}

function createInspector(isNative = true): IInspectorFixture {
  let isOpen = false;
  const open = mock(() => {
    isOpen = true;
  });
  const close = mock(() => {
    isOpen = false;
  });
  let launcher = { click: open };
  const shell = {
    querySelector: () => ({ click: close }),
    querySelectorAll: () => [{ textContent: "Atom Viewer" }, { textContent: "Time travel" }],
  };
  const root = {
    querySelector: (selector: string) => {
      if (!isNative) return null;
      if (selector.startsWith("button.internal-jotai-devtools-trigger-button")) return isOpen ? null : launcher;
      if (selector === ".internal-jotai-devtools-shell.jotai-devtools-shell") return isOpen ? shell : null;
      return null;
    },
  } as unknown as HTMLElement;
  return {
    root,
    open,
    close,
    replaceLauncher: () => {
      const replacement = mock(() => {
        isOpen = true;
      });
      launcher = { click: replacement };
      return replacement;
    },
  };
}

describe("createJotaiDevtoolsDetector", () => {
  test("targets each persistent native root across open state and document reordering", () => {
    const first = createInspector();
    const second = createInspector();
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
    const original = createInspector();
    const replacement = createInspector();
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
    const unrelated = createInspector(false);
    const native = createInspector();
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
