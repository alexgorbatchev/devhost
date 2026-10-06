import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import { createReactHookFormDevtoolsDetector } from "../createReactHookFormDevtoolsDetector";

interface IInspectorFixture {
  closeButton: HTMLButtonElement;
  close: ReturnType<typeof mock>;
  open: ReturnType<typeof mock>;
}

function createInspector(heading = "■ React Hook Form"): IInspectorFixture {
  const open = mock(() => true);
  const close = mock(() => {});
  const launcher = {
    tagName: "BUTTON",
    matches: (selector: string) =>
      selector === 'button[title="Show dev panel"]:has(> svg[aria-label="React Hook Form Logo"])',
    querySelector: () => ({ dispatchEvent: open }),
  };
  const panel = {
    parentElement: { nextElementSibling: launcher },
    querySelector: (selector: string) => {
      const elements: Record<string, unknown> = {
        'input[placeholder="Filter name..."]': {},
        'button[title="Toggle entire fields"]': {},
        'header > button[title="Close dev panel"]': { click: close },
      };
      return elements[selector] ?? null;
    },
  };
  const header = { parentElement: panel, querySelector: () => ({ textContent: heading }) };
  return { closeButton: { parentElement: header } as unknown as HTMLButtonElement, close, open };
}

describe("createReactHookFormDevtoolsDetector", () => {
  const originalMouseEvent = globalThis.MouseEvent;
  beforeEach(() => {
    globalThis.MouseEvent = class extends Event {} as unknown as typeof MouseEvent;
  });
  afterEach(() => {
    globalThis.MouseEvent = originalMouseEvent;
  });
  test("targets separate native inspectors after their document order changes", () => {
    const first = createInspector();
    const second = createInspector();
    let buttons = [first.closeButton, second.closeButton];
    const hostDocument = { querySelectorAll: () => buttons } as unknown as Document;
    const readAdapters = createReactHookFormDevtoolsDetector(hostDocument);
    const [firstAdapter, secondAdapter] = readAdapters();
    assert(firstAdapter !== undefined && secondAdapter !== undefined);
    buttons = [second.closeButton, first.closeButton];
    expect(readAdapters().map((adapter) => adapter.id)).toEqual(["react-hook-form-2", "react-hook-form-1"]);
    firstAdapter.open();
    secondAdapter.close();
    expect(first.open).toHaveBeenCalledTimes(1);
    expect(first.close).toHaveBeenCalledTimes(0);
    expect(second.open).toHaveBeenCalledTimes(0);
    expect(second.close).toHaveBeenCalledTimes(1);
    expect(firstAdapter.isInstalled()).toBe(true);
    expect(firstAdapter.isOpen()).toBe(false);
  });

  test("removed identity cannot target a remounted inspector", () => {
    const original = createInspector();
    const replacement = createInspector();
    let buttons = [original.closeButton];
    const readAdapters = createReactHookFormDevtoolsDetector({
      querySelectorAll: () => buttons,
    } as unknown as Document);
    const [removedAdapter] = readAdapters();
    assert(removedAdapter !== undefined);
    buttons = [replacement.closeButton];
    const [replacementAdapter] = readAdapters();
    assert(replacementAdapter !== undefined);
    expect(replacementAdapter.id).toBe("react-hook-form-2");
    expect(removedAdapter.isInstalled()).toBe(false);
    expect(removedAdapter.isOpen()).toBe(false);
    removedAdapter.open();
    removedAdapter.close();
    replacementAdapter.open();
    expect(replacement.open).toHaveBeenCalledTimes(1);
    expect(replacement.close).toHaveBeenCalledTimes(0);
    expect(original.open).toHaveBeenCalledTimes(0);
    expect(original.close).toHaveBeenCalledTimes(0);
  });

  test("generic panel controls do not register a React Hook Form inspector", () => {
    const unrelated = createInspector("Some other panel");
    const inspector = createInspector();
    const readAdapters = createReactHookFormDevtoolsDetector({
      querySelectorAll: () => [unrelated.closeButton, inspector.closeButton],
    } as unknown as Document);
    const adapters = readAdapters();
    expect(adapters).toHaveLength(1);
    const [adapter] = adapters;
    assert(adapter !== undefined);
    adapter.open();
    expect(inspector.open).toHaveBeenCalledTimes(1);
    expect(unrelated.open).toHaveBeenCalledTimes(0);
  });
});
