import { assert, describe, expect, test } from "vitest";

import { createReactHookFormDevtoolsDetector } from "../createReactHookFormDevtoolsDetector";

interface IInspector {
  /** The inspector's own subtree, to add to the page and to move within it. */
  element: HTMLElement;
  readCloseCount: () => number;
  readOpenCount: () => number;
}

const svgNamespace: string = "http://www.w3.org/2000/svg";

/**
 * A closed panel with the markup the native 4.4.0 inspector renders: the panel inside its animation wrapper,
 * followed by the launcher button, whose logo owns the open handler.
 */
function createInspector(heading: string = "■ React Hook Form"): IInspector {
  const element: HTMLElement = document.createElement("section");
  const wrapper: HTMLDivElement = document.createElement("div");
  const panel: HTMLDivElement = document.createElement("div");
  const header: HTMLElement = document.createElement("header");
  const title: HTMLParagraphElement = document.createElement("p");
  const closeButton: HTMLButtonElement = document.createElement("button");
  const filter: HTMLInputElement = document.createElement("input");
  const toggleFields: HTMLButtonElement = document.createElement("button");
  const launcher: HTMLButtonElement = document.createElement("button");
  const logo: Element = document.createElementNS(svgNamespace, "svg");
  let closeCount: number = 0;
  let openCount: number = 0;

  title.textContent = heading;
  closeButton.title = "Close dev panel";
  closeButton.addEventListener("click", (): void => {
    closeCount += 1;
  });
  filter.placeholder = "Filter name...";
  toggleFields.title = "Toggle entire fields";
  launcher.title = "Show dev panel";
  logo.setAttribute("aria-label", "React Hook Form Logo");
  logo.addEventListener("click", (): void => {
    openCount += 1;
  });
  header.append(title, closeButton);
  panel.append(header, filter, toggleFields);
  wrapper.append(panel);
  launcher.append(logo);
  element.append(wrapper, launcher);

  return { element, readCloseCount: (): number => closeCount, readOpenCount: (): number => openCount };
}

describe("createReactHookFormDevtoolsDetector", () => {
  test("targets separate native inspectors after their document order changes", () => {
    const first = createInspector();
    const second = createInspector();

    document.body.append(first.element, second.element);

    const readAdapters = createReactHookFormDevtoolsDetector(document);
    const [firstAdapter, secondAdapter] = readAdapters();
    assert(firstAdapter !== undefined && secondAdapter !== undefined);
    document.body.append(first.element);
    expect(readAdapters().map((adapter) => adapter.id)).toEqual(["react-hook-form-2", "react-hook-form-1"]);
    firstAdapter.open();
    secondAdapter.close();
    expect(first.readOpenCount()).toBe(1);
    expect(first.readCloseCount()).toBe(0);
    expect(second.readOpenCount()).toBe(0);
    expect(second.readCloseCount()).toBe(1);
    expect(firstAdapter.isInstalled()).toBe(true);
    expect(firstAdapter.isOpen()).toBe(false);
  });

  test("reports an inspector open while its launcher is gone, also past a stylesheet Emotion inserted", () => {
    const inspector = createInspector();
    const launcher: Element | null = inspector.element.querySelector('button[title="Show dev panel"]');

    assert(launcher !== null);
    document.body.append(inspector.element);
    launcher.before(document.createElement("style"));

    const [adapter] = createReactHookFormDevtoolsDetector(document)();
    assert(adapter !== undefined);
    expect(adapter.isOpen()).toBe(false);
    adapter.open();
    expect(inspector.readOpenCount()).toBe(1);

    launcher.remove();
    expect(adapter.isInstalled()).toBe(true);
    expect(adapter.isOpen()).toBe(true);
  });

  test("removed identity cannot target a remounted inspector", () => {
    const original = createInspector();
    const replacement = createInspector();

    document.body.append(original.element);

    const readAdapters = createReactHookFormDevtoolsDetector(document);
    const [removedAdapter] = readAdapters();
    assert(removedAdapter !== undefined);
    original.element.replaceWith(replacement.element);
    const [replacementAdapter] = readAdapters();
    assert(replacementAdapter !== undefined);
    expect(replacementAdapter.id).toBe("react-hook-form-2");
    expect(removedAdapter.isInstalled()).toBe(false);
    expect(removedAdapter.isOpen()).toBe(false);
    removedAdapter.open();
    removedAdapter.close();
    replacementAdapter.open();
    expect(replacement.readOpenCount()).toBe(1);
    expect(replacement.readCloseCount()).toBe(0);
    expect(original.readOpenCount()).toBe(0);
    expect(original.readCloseCount()).toBe(0);
  });

  test("generic panel controls do not register a React Hook Form inspector", () => {
    const unrelated = createInspector("Some other panel");
    const inspector = createInspector();

    document.body.append(unrelated.element, inspector.element);

    const adapters = createReactHookFormDevtoolsDetector(document)();
    expect(adapters).toHaveLength(1);
    const [adapter] = adapters;
    assert(adapter !== undefined);
    adapter.open();
    expect(inspector.readOpenCount()).toBe(1);
    expect(unrelated.readOpenCount()).toBe(0);
  });
});
