import { assert, describe, expect, test } from "vitest";

import { externalDevtoolsDetectors } from "../externalDevtoolsDetectors";
import type { IExternalDevtoolsAdapter } from "../types";
import { factory_tanStackShell } from "./fixtures/fixtures";
import type { ReadClickCount } from "./helpers";

/** Adds markup to the page, as a standalone TanStack devtools renders it there. */
function renderOnPage(markup: string): void {
  document.body.insertAdjacentHTML("beforeend", markup);
}

/** Counts the clicks the element matching `selector` receives from now on. */
function countClicks(selector: string): ReadClickCount {
  const element: Element | null = document.querySelector(selector);
  let clickCount: number = 0;

  assert(element !== null, `Nothing on the page matches ${selector}`);
  element.addEventListener("click", (): void => {
    clickCount += 1;
  });

  return (): number => clickCount;
}

function readAdapter(id: string): IExternalDevtoolsAdapter {
  const adapter = externalDevtoolsDetectors.find((candidate) => candidate.id === id);

  assert(adapter !== undefined, `Missing adapter: ${id}`);

  return adapter;
}

describe("externalDevtoolsDetectors", () => {
  test("no adapter reports devtools on a page without them", () => {
    expect(externalDevtoolsDetectors.map((adapter) => [adapter.id, adapter.isInstalled(), adapter.isOpen()])).toEqual([
      ["tanstack-router", false, false],
      ["tanstack-query", false, false],
      ["tanstack-devtools", false, false],
    ]);
  });

  test("query adapter opens with the open button and closes with the minimize button", () => {
    renderOnPage(`
      <div class="tsqd-open-btn-container"><button class="tsqd-open-btn"></button></div>
      <div class="tsqd-main-panel"></div>
      <button class="tsqd-minimize-btn"></button>
    `);

    const readOpenCount = countClicks(".tsqd-open-btn");
    const readCloseCount = countClicks(".tsqd-minimize-btn");
    const adapter = readAdapter("tanstack-query");

    expect(adapter.isInstalled()).toBe(true);
    expect(adapter.isOpen()).toBe(true);
    adapter.open();
    adapter.close();
    expect(readOpenCount()).toBe(1);
    expect(readCloseCount()).toBe(1);
    expect(adapter.hideSelectors).toEqual([
      '.tsqd-open-btn-container:not([data-testid="tanstack_devtools"] *)',
      '.tsqd-open-btn:not([data-testid="tanstack_devtools"] *)',
      '.tsqd-minimize-btn:not([data-testid="tanstack_devtools"] *)',
    ]);
  });

  test("query adapter is closed while only its open button is on the page", () => {
    renderOnPage(`<button class="tsqd-open-btn"></button>`);

    const adapter = readAdapter("tanstack-query");

    expect(adapter.isInstalled()).toBe(true);
    expect(adapter.isOpen()).toBe(false);
  });

  test("query adapter falls back to the buttons inside the panel", () => {
    renderOnPage(`
      <div class="tsqd-main-panel">
        <button aria-label="Open Tanstack query devtools"></button>
        <button aria-label="Close tanstack query devtools"></button>
      </div>
    `);

    const readOpenCount = countClicks('button[aria-label="Open Tanstack query devtools"]');
    const readCloseCount = countClicks('button[aria-label="Close tanstack query devtools"]');
    const adapter = readAdapter("tanstack-query");

    expect(adapter.isInstalled()).toBe(true);
    adapter.open();
    expect(readOpenCount()).toBe(1);
    expect(readCloseCount()).toBe(0);
    adapter.close();
    expect(readCloseCount()).toBe(1);
  });

  test("query and router adapters leave devtools inside a unified shell to the shell adapter", () => {
    renderOnPage(`
      <div data-testid="tanstack_devtools">
        <button class="tsqd-open-btn"></button>
        <div class="tsqd-main-panel"></div>
        <footer class="TanStackRouterDevtools"><button></button></footer>
        <div class="TanStackRouterDevtoolsPanel"><button></button></div>
      </div>
    `);

    const readQueryOpenCount = countClicks(".tsqd-open-btn");
    const readRouterToggleCount = countClicks("footer.TanStackRouterDevtools > button");

    expect(readAdapter("tanstack-query").isInstalled()).toBe(false);
    expect(readAdapter("tanstack-query").isOpen()).toBe(false);
    expect(readAdapter("tanstack-router").isInstalled()).toBe(false);
    expect(readAdapter("tanstack-router").isOpen()).toBe(false);
    readAdapter("tanstack-query").open();
    readAdapter("tanstack-router").open();
    expect(readQueryOpenCount()).toBe(0);
    expect(readRouterToggleCount()).toBe(0);
  });

  test("router adapter opens with the footer button and closes with the panel collapse button", () => {
    renderOnPage(`
      <footer class="TanStackRouterDevtools"><button></button></footer>
      <div class="TanStackRouterDevtoolsPanel"><button></button></div>
    `);

    const readToggleCount = countClicks("footer.TanStackRouterDevtools > button");
    const readCloseCount = countClicks(".TanStackRouterDevtoolsPanel > button");
    const adapter = readAdapter("tanstack-router");

    expect(adapter.isInstalled()).toBe(true);
    expect(adapter.isOpen()).toBe(true);
    adapter.open();
    adapter.close();
    expect(readToggleCount()).toBe(1);
    expect(readCloseCount()).toBe(1);
    expect(adapter.hideSelectors).toEqual([
      'footer.TanStackRouterDevtools > button:not([data-testid="tanstack_devtools"] *)',
    ]);
  });

  test.each([
    ["not displayed", "display: none"],
    ["hidden", "visibility: hidden"],
  ])("router adapter reports closed while its panel is %s", (_state: string, style: string) => {
    renderOnPage(`<div class="TanStackRouterDevtoolsPanel" style="${style}"></div>`);

    const adapter = readAdapter("tanstack-router");

    expect(adapter.isInstalled()).toBe(true);
    expect(adapter.isOpen()).toBe(false);
  });

  test("unified shell reads native data-open instead of persistent panel presence", () => {
    const shell = factory_tanStackShell(false);

    document.body.append(shell.root);

    const adapter = readAdapter("tanstack-devtools");
    expect(adapter.isInstalled()).toBe(true);
    expect(adapter.isOpen()).toBe(false);
    adapter.open();
    expect(shell.readOpenCount()).toBe(1);
    expect(adapter.isOpen()).toBe(true);
    adapter.close();
    expect(shell.readCloseCount()).toBe(1);
    expect(adapter.isOpen()).toBe(false);
  });

  test("unified shell re-queries replaced roots for actions and drops stale roots", () => {
    const original = factory_tanStackShell(false);
    const replacement = factory_tanStackShell(false);

    document.body.append(original.root);

    const adapter = readAdapter("tanstack-devtools");
    expect(adapter.isInstalled()).toBe(true);
    original.root.replaceWith(replacement.root);
    adapter.open();
    expect(original.readOpenCount()).toBe(0);
    expect(replacement.readOpenCount()).toBe(1);
    replacement.root.remove();
    expect(adapter.isInstalled()).toBe(false);
    expect(adapter.isOpen()).toBe(false);
    adapter.close();
    expect(replacement.readCloseCount()).toBe(0);
  });

  test("unified shell needs the verified panel and native opening control together", () => {
    const shellWithoutTrigger = factory_tanStackShell(false, false);
    const shellWithoutPanel = factory_tanStackShell(false, true, false);
    const adapter = readAdapter("tanstack-devtools");

    document.body.append(shellWithoutTrigger.root);
    expect(adapter.isInstalled()).toBe(false);
    shellWithoutTrigger.root.replaceWith(shellWithoutPanel.root);
    expect(adapter.isInstalled()).toBe(false);
  });

  test("one unified shell adapter opens a closed root and closes an open root", () => {
    const closed = factory_tanStackShell(false);
    const open = factory_tanStackShell(true);

    document.body.append(closed.root, open.root);

    const adapter = readAdapter("tanstack-devtools");
    expect(adapter.isOpen()).toBe(true);
    adapter.close();
    expect(closed.readCloseCount()).toBe(0);
    expect(open.readCloseCount()).toBe(1);
    adapter.open();
    expect(closed.readOpenCount()).toBe(1);
    expect(open.readOpenCount()).toBe(0);
  });
});
