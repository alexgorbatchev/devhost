import assert from "node:assert/strict";

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

globalThis.MouseEvent = class MouseEvent {} as unknown as typeof MouseEvent;

import { externalDevtoolsDetectors } from "../externalDevtoolsDetectors";
import type { IExternalDevtoolsAdapter } from "../types";

type DispatchEventFn = (event: Event) => boolean;

interface IShellFixture {
  root: HTMLElement;
  openButton: ReturnType<typeof mock<DispatchEventFn>>;
  closeButton: ReturnType<typeof mock<DispatchEventFn>>;
}

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
    expect(adapter.hideSelectors).toEqual([
      '.tsqd-open-btn-container:not([data-testid="tanstack_devtools"] *)',
      '.tsqd-open-btn:not([data-testid="tanstack_devtools"] *)',
      '.tsqd-minimize-btn:not([data-testid="tanstack_devtools"] *)',
    ]);
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
    expect(adapter.hideSelectors).toEqual([
      'footer.TanStackRouterDevtools > button:not([data-testid="tanstack_devtools"] *)',
    ]);
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

  test("unified shell reads native data-open instead of persistent panel presence", () => {
    const shell = createShellFixture(false);
    mockShellDocument([shell.root]);
    const adapter = readAdapter("tanstack-devtools");
    expect(adapter.isInstalled()).toBe(true);
    expect(adapter.isOpen()).toBe(false);
    adapter.open();
    expect(shell.openButton).toHaveBeenCalledTimes(1);
    expect(adapter.isOpen()).toBe(true);
    adapter.close();
    expect(shell.closeButton).toHaveBeenCalledTimes(1);
    expect(adapter.isOpen()).toBe(false);
  });

  test("unified shell re-queries replaced roots for actions and drops stale roots", () => {
    const original = createShellFixture(false);
    const replacement = createShellFixture(false);
    mockShellDocument([original.root]);
    const adapter = readAdapter("tanstack-devtools");
    expect(adapter.isInstalled()).toBe(true);
    mockShellDocument([replacement.root]);
    adapter.open();
    expect(original.openButton).not.toHaveBeenCalled();
    expect(replacement.openButton).toHaveBeenCalledTimes(1);
    mockShellDocument([]);
    expect(adapter.isInstalled()).toBe(false);
    expect(adapter.isOpen()).toBe(false);
    adapter.close();
    expect(replacement.closeButton).not.toHaveBeenCalled();
  });

  test("unified shell needs the verified panel and native opening control together", () => {
    mockShellDocument([createShellFixture(false, false).root]);
    const adapter = readAdapter("tanstack-devtools");
    expect(adapter.isInstalled()).toBe(false);
    mockShellDocument([createShellFixture(false, true, false).root]);
    expect(adapter.isInstalled()).toBe(false);
  });

  test("one unified shell adapter opens a closed root and closes an open root", () => {
    const closed = createShellFixture(false);
    const open = createShellFixture(true);
    mockShellDocument([closed.root, open.root]);
    const adapter = readAdapter("tanstack-devtools");
    expect(adapter.isOpen()).toBe(true);
    adapter.close();
    expect(closed.closeButton).not.toHaveBeenCalled();
    expect(open.closeButton).toHaveBeenCalledTimes(1);
    adapter.open();
    expect(closed.openButton).toHaveBeenCalledTimes(1);
    expect(open.openButton).not.toHaveBeenCalled();
  });
});

function createShellFixture(isOpen: boolean, hasTrigger = true, hasPanel = true): IShellFixture {
  const panel = { getAttribute: () => String(isOpen) };
  const openButton = mock<DispatchEventFn>(() => {
    isOpen = true;
    return true;
  });
  const closeButton = mock<DispatchEventFn>(() => {
    isOpen = false;
    return true;
  });
  const elementsBySelector = new Map<string, unknown>([
    [
      'button[data-tsd-control][aria-label^="Open TanStack Devtools"]',
      hasTrigger ? { dispatchEvent: openButton } : null,
    ],
    ['button[data-testid="tsd-close-button"]', { dispatchEvent: closeButton }],
    ['[data-testid="tanstack-devtools-panel"]', hasPanel ? panel : null],
  ]);
  return {
    root: { querySelector: (selector: string) => elementsBySelector.get(selector) ?? null } as unknown as HTMLElement,
    openButton,
    closeButton,
  };
}

function mockShellDocument(roots: HTMLElement[]): void {
  globalThis.document = {
    querySelectorAll: () => roots,
  } as unknown as Document;
}

function createFakeElement(): IFakeElement {
  return {
    dispatchEvent: mock<DispatchEventFn>(() => true),
  };
}

function mockDocument(elementsBySelector: Record<string, IFakeElement>): void {
  globalThis.document = {
    querySelectorAll: (selector: string) => {
      const matchedElements = selector
        .split(",")
        .map((part) => part.trim())
        .map((part) => elementsBySelector[part])
        .filter((element): element is IFakeElement => element !== undefined);

      return matchedElements.map((element) => ({ ...element, closest: () => null }));
    },
  } as unknown as Document;
}

function readAdapter(id: string): IExternalDevtoolsAdapter {
  const adapter = externalDevtoolsDetectors.find((candidate) => candidate.id === id);

  assert(adapter !== undefined, `Missing adapter: ${id}`);

  return adapter;
}
