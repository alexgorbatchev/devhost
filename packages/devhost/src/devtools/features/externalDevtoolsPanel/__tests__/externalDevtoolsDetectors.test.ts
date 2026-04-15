import assert from "node:assert/strict";

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

globalThis.MouseEvent = class MouseEvent {} as unknown as typeof MouseEvent;

import { externalDevtoolsDetectors } from "../externalDevtoolsDetectors";
import type { IExternalDevtoolsAdapter } from "../types";

type DispatchEventFn = (event: Event) => boolean;

interface IFakeElement {
  dispatchEvent: ReturnType<typeof mock<DispatchEventFn>>;
}

describe("externalDevtoolsDetectors", () => {
  const originalDocument = globalThis.document;
  const originalGetComputedStyle = globalThis.getComputedStyle;

  beforeEach(() => {
    mockDocument({});
    globalThis.getComputedStyle = (() => ({
      display: "block",
      visibility: "visible",
    })) as unknown as typeof getComputedStyle;
  });

  afterEach(() => {
    globalThis.document = originalDocument;
    globalThis.getComputedStyle = originalGetComputedStyle;
  });

  test("query adapter opens with the open button and closes with the minimize button", () => {
    const openButton = createFakeElement();
    const closeButton = createFakeElement();

    mockDocument({
      ".tsqd-main-panel": { dispatchEvent: mock<DispatchEventFn>(() => true) },
      ".tsqd-minimize-btn": closeButton,
      ".tsqd-open-btn": openButton,
    });

    const adapter = readAdapter("tanstack-query");

    expect(adapter.isInstalled()).toBe(true);
    expect(adapter.isOpen()).toBe(true);
    adapter.open();
    adapter.close();
    expect(openButton.dispatchEvent).toHaveBeenCalledTimes(1);
    expect(closeButton.dispatchEvent).toHaveBeenCalledTimes(1);
    expect(adapter.hideSelectors).toEqual([".tsqd-open-btn-container", ".tsqd-open-btn", ".tsqd-minimize-btn"]);
  });

  test("query adapter falls back to the panel open button selector", () => {
    const panelOpenButton = createFakeElement();

    mockDocument({
      '.tsqd-main-panel button[aria-label="Open Tanstack query devtools"]': panelOpenButton,
    });

    const adapter = readAdapter("tanstack-query");

    expect(adapter.isInstalled()).toBe(false);
    adapter.open();
    expect(panelOpenButton.dispatchEvent).toHaveBeenCalledTimes(1);
  });

  test("router adapter opens with the footer button and closes with the panel collapse button", () => {
    const toggleButton = createFakeElement();
    const closeButton = createFakeElement();

    mockDocument({
      ".TanStackRouterDevtoolsPanel": { dispatchEvent: mock<DispatchEventFn>(() => true) },
      ".TanStackRouterDevtoolsPanel > button": closeButton,
      "footer.TanStackRouterDevtools > button": toggleButton,
    });
    globalThis.getComputedStyle = (() => ({
      display: "block",
      visibility: "visible",
    })) as unknown as typeof getComputedStyle;

    const adapter = readAdapter("tanstack-router");

    expect(adapter.isInstalled()).toBe(true);
    expect(adapter.isOpen()).toBe(true);
    adapter.open();
    adapter.close();
    expect(toggleButton.dispatchEvent).toHaveBeenCalledTimes(1);
    expect(closeButton.dispatchEvent).toHaveBeenCalledTimes(1);
    expect(adapter.hideSelectors).toEqual(["footer.TanStackRouterDevtools > button"]);
  });

  test("router adapter reports closed when the panel is hidden", () => {
    mockDocument({
      ".TanStackRouterDevtoolsPanel": { dispatchEvent: mock<DispatchEventFn>(() => true) },
    });
    globalThis.getComputedStyle = (() => ({
      display: "none",
      visibility: "hidden",
    })) as unknown as typeof getComputedStyle;

    const adapter = readAdapter("tanstack-router");

    expect(adapter.isOpen()).toBe(false);
  });
});

function createFakeElement(): IFakeElement {
  return {
    dispatchEvent: mock<DispatchEventFn>(() => true),
  };
}

function mockDocument(elementsBySelector: Record<string, IFakeElement>): void {
  globalThis.document = {
    querySelector: (selector: string): IFakeElement | null => {
      const matchedElements = selector
        .split(",")
        .map((part) => part.trim())
        .map((part) => elementsBySelector[part])
        .filter((element): element is IFakeElement => element !== undefined);

      return matchedElements[0] ?? null;
    },
  } as Document;
}

function readAdapter(id: string): IExternalDevtoolsAdapter {
  const adapter = externalDevtoolsDetectors.find((candidate) => candidate.id === id);

  assert(adapter !== undefined, `Missing adapter: ${id}`);

  return adapter;
}
