import { act, renderHook } from "@testing-library/react";
import { assert, beforeEach, describe, expect, onTestFinished, test, vi, type Mock } from "vitest";
import { page, userEvent } from "vitest/browser";

import {
  addDevtoolsButton,
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
import { useAnnotationSelectionDraft } from "../useAnnotationSelectionDraft";

type SelectionDraftParams = Parameters<typeof useAnnotationSelectionDraft>[0];
type ResolveCandidate = IAnnotationSelectionPlugin["resolveCandidate"];
type HostClickListener = (event: MouseEvent) => void;
type PendingCandidate = PromiseWithResolvers<IAnnotationSelectionCandidate | null>;

interface IObservedSelectionPlugin extends IAnnotationSelectionPlugin {
  resolveCandidate: Mock<ResolveCandidate>;
}

const cursorStyleSelector: string = "#devhost-annotation-cursor-style";
const cursorStyleText: string = "body * { cursor: crosshair !important; }";

// The viewport is 1024 by 768. The popup is 320 wide and assumed 220 tall until it is measured.
let plugin: IObservedSelectionPlugin;
let saveButton: HTMLButtonElement;
let cancelButton: HTMLButtonElement;

function selectionDraftParams(overrides: Partial<SelectionDraftParams> = {}): SelectionDraftParams {
  return {
    annotationSelectionPlugin: plugin,
    comment: "",
    isSubmitting: false,
    submissionErrorMessage: null,
    viewportPadding: 10,
    ...overrides,
  };
}

function renderSelectionDraft(overrides: Partial<SelectionDraftParams> = {}) {
  return renderHook((props: SelectionDraftParams) => useAnnotationSelectionDraft(props), {
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

describe("useAnnotationSelectionDraft", () => {
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
    // A press inside a frame moves the focus out of this window, as switching to another window does.
    const frame: HTMLIFrameElement = addHostFrame({ height: 100, width: 200, x: 400, y: 400 });

    await holdAlt();
    expect(hook.result.current.isSelectionMode).toBe(true);

    await click(frame);
    expect(document.activeElement).toBe(frame);
    expect(hook.result.current.isSelectionMode).toBe(false);
  });

  test("leaves Alt alone while submitting or while the user types", async () => {
    const submittingHook = renderSelectionDraft({ isSubmitting: true });

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

  test("selects each clicked element once, numbers them in order, and anchors the popup to the first", async () => {
    const hook = renderSelectionDraft();

    expect(hook.result.current.popupCoordinates).toBeNull();

    await holdAlt();
    await click(cancelButton);
    expect(plugin.resolveCandidate.mock.calls.at(-1)?.[1]).toBe("select");
    expect(hook.result.current.hoveredLabel).toBe('button "Cancel"');
    expect(hook.result.current.isHoveredElementSelected).toBe(true);
    // The popup does not fit to the right of a target at x=900, so it sits to its left: 900 - 320 - 12.
    expect(hook.result.current.popupCoordinates).toEqual({ left: 568, top: 50 });

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
    expect(hook.result.current.popupCoordinates).toEqual({ left: 568, top: 50 });

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

  test("keeps selection clicks from the page but leaves devtools and ordinary clicks alone", async () => {
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
    expect(devtoolsListener).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(devtoolsButton);
    expect(hook.result.current.selectedTargets).toHaveLength(1);
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
    expect(hook.result.current.popupCoordinates).toBeNull();
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

  test("resetSelectionDraft clears the selection, the hover, and selection mode", async () => {
    const hook = renderSelectionDraft();

    await holdAlt();
    await click(saveButton);
    act(() => hook.result.current.resetSelectionDraft());

    expect(hook.result.current.selectedTargets).toEqual([]);
    expect(hook.result.current.hoveredLabel).toBeNull();
    expect(hook.result.current.isSelectionMode).toBe(false);
    expect(hook.result.current.popupCoordinates).toBeNull();
  });

  test("moves the popup and the hover outline with the page when it scrolls", async () => {
    const hook = renderSelectionDraft();

    makePageScrollable();
    placeElementOnPage(saveButton, { height: 20, width: 80, x: 100, y: 200 });
    await holdAlt();
    await click(saveButton);
    expect(hook.result.current.popupCoordinates).toEqual({ left: 112, top: 200 });

    await act(async (): Promise<void> => {
      await userEvent.wheel(saveButton, { delta: { y: 150 } });
      await vi.waitFor(() => expect(window.scrollY).toBe(150));
    });
    await passAnimationFrame();
    expect(hook.result.current.popupCoordinates).toEqual({ left: 112, top: 50 });
    expect(hook.result.current.hoveredRectangle).toEqual({ height: 20, width: 80, x: 100, y: 50 });
  });

  test("moves the popup with its target when the window resizes", async () => {
    const hook = renderSelectionDraft();

    // The cancel button keeps its distance from the right edge, as a docked control does.
    Object.assign(cancelButton.style, { left: "auto", right: "44px" });
    onTestFinished(async (): Promise<void> => {
      await page.viewport(1024, 768);
    });
    await holdAlt();
    await click(cancelButton);
    expect(hook.result.current.popupCoordinates).toEqual({ left: 568, top: 50 });

    await act(async (): Promise<void> => {
      await page.viewport(900, 768);
    });
    await passAnimationFrame();
    // The button is now at x=776: 776 - 320 - 12.
    expect(hook.result.current.popupCoordinates).toEqual({ left: 444, top: 50 });
  });

  test("keeps a popup it has not measured inside the viewport by assuming a height", async () => {
    const hook = renderSelectionDraft();

    placeElement(saveButton, { height: 20, width: 80, x: 100, y: 600 });
    await holdAlt();
    await click(saveButton);
    await passAnimationFrame();

    // 768 - 220 - 10.
    expect(hook.result.current.popupCoordinates).toEqual({ left: 112, top: 538 });
  });

  test("keeps the popup inside the viewport using its measured height", async () => {
    const hook = renderSelectionDraft();
    const popup: HTMLElement = document.createElement("section");

    placeElement(popup, { height: 400, width: 320, x: 0, y: 0 });
    document.body.append(popup);
    placeElement(saveButton, { height: 20, width: 80, x: 100, y: 600 });
    hook.result.current.popupReference.current = popup;

    await holdAlt();
    await click(saveButton);
    await passAnimationFrame();

    // 768 - 400 - 10.
    expect(hook.result.current.popupCoordinates).toEqual({ left: 112, top: 358 });
  });
});
