import { act, renderHook } from "@testing-library/react";
import { assert, beforeEach, describe, expect, onTestFinished, test, vi, type Mock } from "vitest";
import { page, userEvent } from "vitest/browser";

import {
  addDevtoolsButton,
  addDevtoolsTextarea,
  addHostButton,
  addHostFrame,
  makePageScrollable,
  placeElement,
  placeElementOnPage,
  waitForAnimationFrame,
} from "../../../../../../test-support/hostPageUtils";
import type { IAnnotationSelectionCandidate, IAnnotationSelectionPlugin } from "../../annotationSelectionPluginTypes";
import { createDomAnnotationSelectionCandidateForElement } from "../../createDomAnnotationSelectionCandidateForElement";
import { defaultDomAnnotationSelectionPlugin } from "../../defaultDomAnnotationSelectionPlugin";
import { usePageSelection } from "../usePageSelection";

type SelectionDraftParams = Parameters<typeof usePageSelection>[0];
type ResolveCandidate = IAnnotationSelectionPlugin["resolveCandidate"];
type HostClickListener = (event: MouseEvent) => void;
type PendingCandidate = PromiseWithResolvers<IAnnotationSelectionCandidate | null>;

interface IObservedSelectionPlugin extends IAnnotationSelectionPlugin {
  resolveCandidate: Mock<ResolveCandidate>;
}

const cursorStyleSelector: string = "#devhost-annotation-cursor-style";
const cursorStyleText: string = "body * { cursor: crosshair !important; }";

let plugin: IObservedSelectionPlugin;
let saveButton: HTMLButtonElement;
let cancelButton: HTMLButtonElement;

function selectionDraftParams(overrides: Partial<SelectionDraftParams> = {}): SelectionDraftParams {
  return {
    annotationSelectionPlugin: plugin,
    canSelectDevtools: true,
    isDisabled: false,
    ...overrides,
  };
}

function renderSelectionDraft(overrides: Partial<SelectionDraftParams> = {}) {
  return renderHook((props: SelectionDraftParams) => usePageSelection(props), {
    initialProps: selectionDraftParams(overrides),
  });
}

// The keyboard, the pointer, and the wheel are the browser's own: the page receives what a person's input produces.
// The hook's state follows such an event through promises, so each one runs inside `act`.
async function holdKey(key: string): Promise<void> {
  await act(async (): Promise<void> => {
    await userEvent.keyboard(`{${key}>}`);
  });
}

async function releaseKey(key: string): Promise<void> {
  await act(async (): Promise<void> => {
    await userEvent.keyboard(`{/${key}}`);
  });
}

async function holdAlt(): Promise<void> {
  await holdKey("Alt");
}

async function releaseAlt(): Promise<void> {
  await releaseKey("Alt");
}

async function pointAt(element: Element): Promise<void> {
  await act(async (): Promise<void> => {
    await userEvent.hover(element);
  });
}

async function click(element: Element): Promise<void> {
  await act(async (): Promise<void> => {
    await userEvent.click(element);
  });
}

async function passAnimationFrame(): Promise<void> {
  await act(async (): Promise<void> => {
    await waitForAnimationFrame();
  });
}

beforeEach(() => {
  // The DOM plugin the composer uses by default: it hit-tests the pointer position.
  plugin = {
    ...defaultDomAnnotationSelectionPlugin,
    getCursorStyleText: (): string => cursorStyleText,
    resolveCandidate: vi.fn<ResolveCandidate>(defaultDomAnnotationSelectionPlugin.resolveCandidate),
  };
  saveButton = addHostButton("save", "Save", { height: 20, width: 80, x: 100, y: 50 });
  cancelButton = addHostButton("cancel", "Cancel", { height: 20, width: 80, x: 900, y: 50 });
});

describe("usePageSelection", () => {
  test("removes one marker and renumbers subsequent context without duplicating the next marker", async () => {
    const hook = renderSelectionDraft();
    act(() => hook.result.current.startSelection());
    await click(saveButton);
    await click(cancelButton);
    const first = hook.result.current.selectedTargets[0];
    assert(first);
    act(() => hook.result.current.removeSelection(first.candidate.id));
    expect(hook.result.current.selectedTargets.map((target) => target.markerNumber)).toEqual([1]);
    await click(saveButton);
    expect(hook.result.current.selectedTargets.map((target) => target.markerNumber)).toEqual([1, 2]);
  });
  test("lets the toolbar start and stop selection without trapping ordinary page clicks", async () => {
    const hook = renderSelectionDraft();
    const listener = vi.fn<HostClickListener>();
    saveButton.addEventListener("click", listener);
    act(() => hook.result.current.startSelection());
    await click(saveButton);
    expect(hook.result.current.selectedTargets).toHaveLength(1);
    expect(listener).toHaveBeenCalledTimes(0);
    act(() => hook.result.current.stopSelection());
    await click(saveButton);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(hook.result.current.selectedTargets).toHaveLength(1);
  });

  test("discards a pending selection after its context is cleared", async () => {
    const hook = renderSelectionDraft();
    const pending = Promise.withResolvers<IAnnotationSelectionCandidate | null>();
    plugin.resolveCandidate.mockReturnValue(pending.promise);
    await holdAlt();
    await click(saveButton);
    act(() => hook.result.current.clearSelection());
    await act(async () => {
      pending.resolve(createDomAnnotationSelectionCandidateForElement({ element: saveButton }));
    });
    expect(hook.result.current.selectedTargets).toEqual([]);
  });

  test("discards a pending selection after the toolbar stops selection", async () => {
    const hook = renderSelectionDraft();
    const pending = Promise.withResolvers<IAnnotationSelectionCandidate | null>();
    plugin.resolveCandidate.mockReturnValue(pending.promise);
    await holdAlt();
    await click(saveButton);
    act(() => hook.result.current.stopSelection());
    await act(async () => pending.resolve(createDomAnnotationSelectionCandidateForElement({ element: saveButton })));
    expect(hook.result.current.isSelectionMode).toBe(false);
    expect(hook.result.current.selectedTargets).toEqual([]);
  });

  test("disabling the selector releases the page and prevents toolbar activation", async () => {
    const hook = renderSelectionDraft();
    await holdAlt();
    hook.rerender(selectionDraftParams({ isDisabled: true }));
    expect(hook.result.current.isSelectionMode).toBe(false);
    act(() => hook.result.current.startSelection());
    expect(hook.result.current.isSelectionMode).toBe(false);
  });

  test("discards an unresolved selection when the active plugin is replaced", async () => {
    const hook = renderSelectionDraft();
    const pending = Promise.withResolvers<IAnnotationSelectionCandidate | null>();
    plugin.resolveCandidate.mockReturnValue(pending.promise);
    await holdAlt();
    await click(saveButton);
    hook.rerender(selectionDraftParams({ annotationSelectionPlugin: defaultDomAnnotationSelectionPlugin }));
    await act(async () => pending.resolve(createDomAnnotationSelectionCandidateForElement({ element: saveButton })));
    expect(hook.result.current.selectedTargets).toEqual([]);
  });

  test("selects while Alt is held and stops when it is released", async () => {
    const hook = renderSelectionDraft();

    expect(hook.result.current.isSelectionMode).toBe(false);

    await holdKey("Shift");
    expect(hook.result.current.isSelectionMode).toBe(false);

    await holdAlt();
    expect(hook.result.current.isSelectionMode).toBe(true);

    await releaseKey("Shift");
    expect(hook.result.current.isSelectionMode).toBe(true);

    await releaseAlt();
    expect(hook.result.current.isSelectionMode).toBe(false);
  });

  test("stops selecting when the window loses focus", async () => {
    const hook = renderSelectionDraft();
    const frame: HTMLIFrameElement = addHostFrame({ height: 100, width: 200, x: 400, y: 400 });

    await holdAlt();
    expect(hook.result.current.isSelectionMode).toBe(true);

    await click(frame);
    expect(document.activeElement).toBe(frame);
    expect(hook.result.current.isSelectionMode).toBe(false);
  });

  test("leaves Alt alone while submitting or while the user types", async () => {
    const submittingHook = renderSelectionDraft({ isDisabled: true });

    await holdAlt();
    expect(submittingHook.result.current.isSelectionMode).toBe(false);
    await releaseAlt();
    submittingHook.unmount();

    const typingHook = renderSelectionDraft();
    const input: HTMLInputElement = document.createElement("input");

    placeElement(input, { height: 20, width: 200, x: 400, y: 400 });
    document.body.append(input);
    await click(input);
    expect(document.activeElement).toBe(input);

    await holdAlt();
    expect(typingHook.result.current.isSelectionMode).toBe(false);
  });

  test("starts Alt selection from a devtools field, such as the chat composer", async () => {
    const hook = renderSelectionDraft();
    const composer: HTMLTextAreaElement = addDevtoolsTextarea({ height: 40, width: 200, x: 400, y: 400 });

    await click(composer);
    const shadowRoot: Node = composer.getRootNode();
    assert(shadowRoot instanceof ShadowRoot);
    expect(shadowRoot.activeElement).toBe(composer);

    await holdAlt();
    expect(hook.result.current.isSelectionMode).toBe(true);
    await click(saveButton);
    expect(hook.result.current.selectedTargets.map((target) => target.candidate.label)).toEqual(['button "Save"']);
    await releaseAlt();
    expect(hook.result.current.isSelectionMode).toBe(false);
  });

  test("tracks the element under the pointer only while selecting", async () => {
    const hook = renderSelectionDraft();

    await pointAt(cancelButton);
    expect(hook.result.current.hoveredLabel).toBeNull();
    expect(plugin.resolveCandidate).toHaveBeenCalledTimes(0);

    await holdAlt();
    await pointAt(saveButton);
    expect(hook.result.current.hoveredLabel).toBe('button "Save"');
    expect(hook.result.current.hoveredRectangle).toEqual({ height: 20, width: 80, x: 100, y: 50 });
    expect(hook.result.current.isHoveredElementSelected).toBe(false);
    expect(plugin.resolveCandidate.mock.calls.at(-1)?.[1]).toBe("hover");

    await pointAt(cancelButton);
    expect(hook.result.current.hoveredLabel).toBe('button "Cancel"');

    await releaseAlt();
    expect(hook.result.current.hoveredLabel).toBeNull();
    expect(hook.result.current.hoveredRectangle).toBeNull();
  });

  test("selects each clicked element once, numbers them in order, and keeps them after selection stops", async () => {
    const hook = renderSelectionDraft();

    await holdAlt();
    await click(cancelButton);
    expect(plugin.resolveCandidate.mock.calls.at(-1)?.[1]).toBe("select");
    expect(hook.result.current.hoveredLabel).toBe('button "Cancel"');
    expect(hook.result.current.isHoveredElementSelected).toBe(true);

    await click(cancelButton);
    await click(saveButton);

    expect(
      hook.result.current.selectedTargets.map((target) => ({
        label: target.candidate.label,
        markerNumber: target.markerNumber,
      })),
    ).toEqual([
      { label: 'button "Cancel"', markerNumber: 1 },
      { label: 'button "Save"', markerNumber: 2 },
    ]);

    await releaseAlt();
    expect(hook.result.current.selectedTargets).toHaveLength(2);
  });

  test("tells apart elements that share a tag and have no id or class", async () => {
    const firstItem: HTMLLIElement = document.createElement("li");
    const secondItem: HTMLLIElement = document.createElement("li");
    const hook = renderSelectionDraft();

    firstItem.textContent = "First";
    secondItem.textContent = "Second";
    placeElement(firstItem, { height: 20, width: 200, x: 100, y: 300 });
    placeElement(secondItem, { height: 20, width: 200, x: 100, y: 340 });
    document.body.append(firstItem, secondItem);

    await holdAlt();
    await pointAt(firstItem);
    expect(hook.result.current.hoveredRectangle).toEqual({ height: 20, width: 200, x: 100, y: 300 });

    await pointAt(secondItem);
    expect(hook.result.current.hoveredRectangle).toEqual({ height: 20, width: 200, x: 100, y: 340 });

    await click(firstItem);
    expect(hook.result.current.isHoveredElementSelected).toBe(true);

    await pointAt(secondItem);
    expect(hook.result.current.isHoveredElementSelected).toBe(false);

    await click(secondItem);
    await click(secondItem);
    expect(hook.result.current.selectedTargets.map((target) => target.candidate.readRect())).toEqual([
      { height: 20, width: 200, x: 100, y: 300 },
      { height: 20, width: 200, x: 100, y: 340 },
    ]);
    expect(hook.result.current.selectedTargets.map((target) => target.markerNumber)).toEqual([1, 2]);
  });

  test("selects devtools controls without activating them, then restores ordinary clicks", async () => {
    const hook = renderSelectionDraft();
    const devtoolsButton: HTMLButtonElement = addDevtoolsButton({ height: 20, width: 60, x: 400, y: 300 });
    const hostListener = vi.fn<HostClickListener>();
    const devtoolsListener = vi.fn<HostClickListener>();

    saveButton.addEventListener("click", hostListener);
    devtoolsButton.addEventListener("click", devtoolsListener);

    // An ordinary press focuses the button and the page receives the click.
    await click(saveButton);
    expect(hostListener).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(saveButton);
    await click(cancelButton);
    expect(document.activeElement).toBe(cancelButton);

    // A selection press does neither: the focus stays where it was.
    await holdAlt();
    await click(saveButton);
    expect(hostListener).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(cancelButton);
    expect(hook.result.current.selectedTargets).toHaveLength(1);

    await click(devtoolsButton);
    expect(devtoolsListener).toHaveBeenCalledTimes(0);
    expect(document.activeElement).toBe(cancelButton);
    expect(hook.result.current.selectedTargets).toHaveLength(2);
    await releaseAlt();
    await click(devtoolsButton);
    expect(devtoolsListener).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(devtoolsButton);
  });

  test("selects a control through the devtools shadow root while leaving annotation tools usable", async () => {
    const button = addDevtoolsButton({ height: 20, width: 80, x: 400, y: 300 });
    button.textContent = "Settings";
    const host = button.parentElement;
    assert(host);
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.append(button);
    const tools = document.createElement("div");
    tools.setAttribute("data-devhost-annotation-controls", "");
    const stop = document.createElement("button");
    stop.textContent = "Stop Selecting";
    placeElement(stop, { height: 20, width: 100, x: 400, y: 350 });
    tools.append(stop);
    shadowRoot.append(tools);
    const hook = renderSelectionDraft();
    stop.addEventListener("click", () => hook.result.current.stopSelection());
    const listener = vi.fn<HostClickListener>();
    button.addEventListener("click", listener);
    await holdAlt();
    await pointAt(button);
    expect(hook.result.current.hoveredLabel).toBe('button "Settings"');
    await click(button);
    expect(hook.result.current.selectedTargets).toHaveLength(1);
    expect(listener).toHaveBeenCalledTimes(0);
    await click(stop);
    expect(hook.result.current.isSelectionMode).toBe(false);
    expect(hook.result.current.selectedTargets).toHaveLength(1);
  });

  test("uses the DOM selector for devhost controls even when a host plugin declines them", async () => {
    const hook = renderSelectionDraft();
    plugin.resolveCandidate.mockReturnValue(null);
    const button = addDevtoolsButton({ height: 20, width: 80, x: 400, y: 300 });
    button.textContent = "Settings";
    await holdAlt();
    await click(button);
    expect(hook.result.current.selectedTargets.map((target) => target.candidate.label)).toEqual(['button "Settings"']);
    expect(plugin.resolveCandidate).toHaveBeenCalledTimes(0);
  });

  test("leaves devtools controls working and unselected while devhost UI is not annotated", async () => {
    const hook = renderSelectionDraft({ canSelectDevtools: false });
    const devtoolsButton = addDevtoolsButton({ height: 20, width: 80, x: 400, y: 300 });
    devtoolsButton.textContent = "Settings";
    const devtoolsListener = vi.fn<HostClickListener>();
    devtoolsButton.addEventListener("click", devtoolsListener);
    await holdAlt();
    await pointAt(devtoolsButton);
    expect(hook.result.current.hoveredLabel).toBeNull();
    await click(devtoolsButton);
    expect(devtoolsListener).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(devtoolsButton);
    expect(hook.result.current.selectedTargets).toEqual([]);
    expect(plugin.resolveCandidate).toHaveBeenCalledTimes(0);
    await click(saveButton);
    expect(hook.result.current.selectedTargets.map((target) => target.candidate.label)).toEqual(['button "Save"']);
  });

  test("selects a devhost panel background instead of page content behind it", async () => {
    const hook = renderSelectionDraft();
    const host = document.createElement("div");
    host.setAttribute("data-devhost-devtools", "");
    const panel = document.createElement("div");
    panel.setAttribute("aria-label", "Devhost panel");
    placeElement(panel, { height: 40, width: 100, x: 90, y: 40 });
    host.append(panel);
    document.body.append(host);
    await holdAlt();
    await click(panel);
    expect(hook.result.current.selectedTargets.map((target) => target.candidate.label)).toEqual([
      "div [Devhost panel]",
    ]);
  });

  test("selects nothing when the plugin offers no candidate for a click", async () => {
    const hook = renderSelectionDraft();
    const hostListener = vi.fn<HostClickListener>();

    saveButton.addEventListener("click", hostListener);
    plugin.resolveCandidate.mockReturnValue(null);
    await holdAlt();
    await click(saveButton);

    expect(plugin.resolveCandidate.mock.calls.at(-1)?.[1]).toBe("select");
    expect(hostListener).toHaveBeenCalledTimes(0);
    expect(hook.result.current.selectedTargets).toEqual([]);
  });

  test("installs the plugin's cursor style only while selecting", async () => {
    renderSelectionDraft();

    expect(document.querySelector(cursorStyleSelector)).toBeNull();

    await holdAlt();
    expect(document.querySelector(cursorStyleSelector)?.textContent).toBe(cursorStyleText);

    await releaseAlt();
    expect(document.querySelector(cursorStyleSelector)).toBeNull();
  });

  test("removes the cursor style when it unmounts while selecting", async () => {
    const hook = renderSelectionDraft();

    await holdAlt();
    expect(document.querySelector(cursorStyleSelector)).not.toBeNull();

    hook.unmount();
    expect(document.querySelector(cursorStyleSelector)).toBeNull();
  });

  test("installs no cursor style for a plugin that provides none", async () => {
    const { getCursorStyleText: _getCursorStyleText, ...pluginWithoutCursorStyle } = plugin;

    renderSelectionDraft({ annotationSelectionPlugin: pluginWithoutCursorStyle });
    await holdAlt();

    expect(document.querySelector(cursorStyleSelector)).toBeNull();
  });

  test("drops a hover result that arrives after a newer one or after selecting stopped", async () => {
    const pending: PendingCandidate[] = [];
    const deferredPlugin: IAnnotationSelectionPlugin = {
      id: "deferred",
      label: "Deferred",
      resolveCandidate: (): Promise<IAnnotationSelectionCandidate | null> => {
        const resolution: PendingCandidate = Promise.withResolvers<IAnnotationSelectionCandidate | null>();

        pending.push(resolution);

        return resolution.promise;
      },
    };
    const saveCandidate = createDomAnnotationSelectionCandidateForElement({ element: saveButton });
    const cancelCandidate = createDomAnnotationSelectionCandidateForElement({ element: cancelButton });
    const hook = renderSelectionDraft({ annotationSelectionPlugin: deferredPlugin });

    await holdAlt();
    await pointAt(saveButton);
    await pointAt(cancelButton);
    await pointAt(saveButton);

    const [firstHover, secondHover, thirdHover] = pending;

    assert(firstHover !== undefined && secondHover !== undefined && thirdHover !== undefined);
    expect(pending).toHaveLength(3);

    // The newest hover wins, even when an older one resolves later.
    await act(async (): Promise<void> => {
      thirdHover.resolve(saveCandidate);
    });
    expect(hook.result.current.hoveredLabel).toBe('button "Save"');

    await act(async (): Promise<void> => {
      firstHover.resolve(cancelCandidate);
      secondHover.resolve(cancelCandidate);
    });
    expect(hook.result.current.hoveredLabel).toBe('button "Save"');

    await pointAt(cancelButton);
    await releaseAlt();

    const lateHover: PendingCandidate | undefined = pending[3];

    assert(lateHover !== undefined);
    await act(async (): Promise<void> => {
      lateHover.resolve(cancelCandidate);
    });
    expect(hook.result.current.hoveredLabel).toBeNull();
  });

  test("clearSelection clears the selection, the hover, and selection mode", async () => {
    const hook = renderSelectionDraft();

    await holdAlt();
    await click(saveButton);
    act(() => hook.result.current.clearSelection());

    expect(hook.result.current.selectedTargets).toEqual([]);
    expect(hook.result.current.hoveredLabel).toBeNull();
    expect(hook.result.current.isSelectionMode).toBe(false);
  });

  test("moves the hover outline with the page when it scrolls", async () => {
    const hook = renderSelectionDraft();

    makePageScrollable();
    placeElementOnPage(saveButton, { height: 20, width: 80, x: 100, y: 200 });
    await holdAlt();
    await click(saveButton);

    await act(async (): Promise<void> => {
      await userEvent.wheel(saveButton, { delta: { y: 150 } });
      await vi.waitFor(() => expect(window.scrollY).toBe(150));
    });
    await passAnimationFrame();
    expect(hook.result.current.hoveredRectangle).toEqual({ height: 20, width: 80, x: 100, y: 50 });
  });

  test("moves the selected target outline when the window resizes", async () => {
    const hook = renderSelectionDraft();

    // The cancel button keeps its distance from the right edge, as a docked control does.
    Object.assign(cancelButton.style, { left: "auto", right: "44px" });
    onTestFinished(async (): Promise<void> => {
      await page.viewport(1024, 768);
    });
    await holdAlt();
    await click(cancelButton);

    await act(async (): Promise<void> => {
      await page.viewport(900, 768);
    });
    await passAnimationFrame();
    expect(hook.result.current.hoveredRectangle).toEqual({ height: 20, width: 80, x: 776, y: 50 });
  });
});
