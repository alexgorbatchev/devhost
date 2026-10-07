import { act, fireEvent, renderHook } from "@testing-library/react";
import { assert, beforeEach, describe, expect, test, vi, type Mock } from "vitest";

import {
  addDevtoolsButton,
  addHostButton,
  placeElement,
  readCenter,
  waitForAnimationFrame,
} from "../../../../../../test-support/hostPageUtils";
import type { IAnnotationSelectionCandidate, IAnnotationSelectionPlugin } from "../../annotationSelectionPluginTypes";
import { createDomAnnotationSelectionCandidateForElement } from "../../createDomAnnotationSelectionCandidateForElement";
import { defaultDomAnnotationSelectionPlugin } from "../../defaultDomAnnotationSelectionPlugin";
import { useAnnotationSelectionDraft } from "../useAnnotationSelectionDraft";

type SelectionDraftParams = Parameters<typeof useAnnotationSelectionDraft>[0];
type ResolveCandidate = IAnnotationSelectionPlugin["resolveCandidate"];
type HostClickListener = (event: MouseEvent) => void;
type KeyTarget = Document | Element;
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

function holdAlt(target: KeyTarget = document): void {
  fireEvent.keyDown(target, { key: "Alt" });
}

function releaseAlt(): void {
  fireEvent.keyUp(document, { key: "Alt" });
}

// Candidates resolve through promises, so the hook's state follows the event.
async function pointAt(element: Element): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.mouseMove(element, readCenter(element));
  });
}

/** Clicks the center of `element` and reports whether the page still received the click's default action. */
async function click(element: Element): Promise<boolean> {
  let isDefaultAllowed: boolean = true;

  await act(async (): Promise<void> => {
    isDefaultAllowed = fireEvent.click(element, readCenter(element));
  });

  return isDefaultAllowed;
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
  test("selects while Alt is held and stops when it is released", () => {
    const hook = renderSelectionDraft();

    expect(hook.result.current.isSelectionMode).toBe(false);

    fireEvent.keyDown(document, { key: "Shift" });
    expect(hook.result.current.isSelectionMode).toBe(false);

    holdAlt();
    expect(hook.result.current.isSelectionMode).toBe(true);

    fireEvent.keyUp(document, { key: "Shift" });
    expect(hook.result.current.isSelectionMode).toBe(true);

    releaseAlt();
    expect(hook.result.current.isSelectionMode).toBe(false);
  });

  test("stops selecting when the window loses focus", () => {
    const hook = renderSelectionDraft();

    holdAlt();
    fireEvent.blur(window);

    expect(hook.result.current.isSelectionMode).toBe(false);
  });

  test("leaves Alt alone while submitting or while the user types", () => {
    const submittingHook = renderSelectionDraft({ isSubmitting: true });

    holdAlt();
    expect(submittingHook.result.current.isSelectionMode).toBe(false);
    submittingHook.unmount();

    const typingHook = renderSelectionDraft();
    const input: HTMLInputElement = document.createElement("input");

    document.body.append(input);
    holdAlt(input);
    expect(typingHook.result.current.isSelectionMode).toBe(false);
  });

  test("tracks the element under the pointer only while selecting", async () => {
    const hook = renderSelectionDraft();

    await pointAt(saveButton);
    expect(hook.result.current.hoveredLabel).toBeNull();
    expect(plugin.resolveCandidate).toHaveBeenCalledTimes(0);

    holdAlt();
    await pointAt(saveButton);
    expect(hook.result.current.hoveredLabel).toBe('button "Save"');
    expect(hook.result.current.hoveredRectangle).toEqual({ height: 20, width: 80, x: 100, y: 50 });
    expect(hook.result.current.isHoveredElementSelected).toBe(false);
    expect(plugin.resolveCandidate.mock.calls.at(-1)?.[1]).toBe("hover");

    await pointAt(cancelButton);
    expect(hook.result.current.hoveredLabel).toBe('button "Cancel"');

    releaseAlt();
    expect(hook.result.current.hoveredLabel).toBeNull();
    expect(hook.result.current.hoveredRectangle).toBeNull();
  });

  test("selects each clicked element once, numbers them in order, and anchors the popup to the first", async () => {
    const hook = renderSelectionDraft();

    expect(hook.result.current.popupCoordinates).toBeNull();

    holdAlt();
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

    releaseAlt();
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

    holdAlt();
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

    expect(await click(saveButton)).toBe(true);
    expect(hostListener).toHaveBeenCalledTimes(1);

    holdAlt();
    expect(fireEvent.mouseDown(saveButton, readCenter(saveButton))).toBe(false);
    expect(await click(saveButton)).toBe(false);
    expect(hostListener).toHaveBeenCalledTimes(1);
    expect(hook.result.current.selectedTargets).toHaveLength(1);

    expect(fireEvent.mouseDown(devtoolsButton, readCenter(devtoolsButton))).toBe(true);
    expect(await click(devtoolsButton)).toBe(true);
    expect(devtoolsListener).toHaveBeenCalledTimes(1);
    expect(hook.result.current.selectedTargets).toHaveLength(1);
  });

  test("selects nothing when the plugin offers no candidate for a click", async () => {
    const hook = renderSelectionDraft();

    plugin.resolveCandidate.mockReturnValueOnce(null);
    holdAlt();

    expect(await click(saveButton)).toBe(false);
    expect(hook.result.current.selectedTargets).toEqual([]);
    expect(hook.result.current.popupCoordinates).toBeNull();
  });

  test("installs the plugin's cursor style only while selecting", () => {
    renderSelectionDraft();

    expect(document.querySelector(cursorStyleSelector)).toBeNull();

    holdAlt();
    expect(document.querySelector(cursorStyleSelector)?.textContent).toBe(cursorStyleText);

    releaseAlt();
    expect(document.querySelector(cursorStyleSelector)).toBeNull();
  });

  test("removes the cursor style when it unmounts while selecting", () => {
    const hook = renderSelectionDraft();

    holdAlt();
    expect(document.querySelector(cursorStyleSelector)).not.toBeNull();

    hook.unmount();
    expect(document.querySelector(cursorStyleSelector)).toBeNull();
  });

  test("installs no cursor style for a plugin that provides none", () => {
    const { getCursorStyleText: _getCursorStyleText, ...pluginWithoutCursorStyle } = plugin;

    renderSelectionDraft({ annotationSelectionPlugin: pluginWithoutCursorStyle });
    holdAlt();

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

    holdAlt();
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
    releaseAlt();

    const lateHover: PendingCandidate | undefined = pending[3];

    assert(lateHover !== undefined);
    await act(async (): Promise<void> => {
      lateHover.resolve(cancelCandidate);
    });
    expect(hook.result.current.hoveredLabel).toBeNull();
  });

  test("resetSelectionDraft clears the selection, the hover, and selection mode", async () => {
    const hook = renderSelectionDraft();

    holdAlt();
    await click(saveButton);
    act(() => hook.result.current.resetSelectionDraft());

    expect(hook.result.current.selectedTargets).toEqual([]);
    expect(hook.result.current.hoveredLabel).toBeNull();
    expect(hook.result.current.isSelectionMode).toBe(false);
    expect(hook.result.current.popupCoordinates).toBeNull();
  });

  test("moves the popup and the hover outline with the page when it scrolls or resizes", async () => {
    const hook = renderSelectionDraft();

    holdAlt();
    await click(saveButton);
    expect(hook.result.current.popupCoordinates).toEqual({ left: 112, top: 50 });

    placeElement(saveButton, { height: 20, width: 80, x: 300, y: 200 });
    fireEvent.scroll(window);
    await passAnimationFrame();
    expect(hook.result.current.popupCoordinates).toEqual({ left: 312, top: 200 });
    expect(hook.result.current.hoveredRectangle).toEqual({ height: 20, width: 80, x: 300, y: 200 });

    placeElement(saveButton, { height: 20, width: 80, x: 40, y: 120 });
    fireEvent.resize(window);
    await passAnimationFrame();
    expect(hook.result.current.popupCoordinates).toEqual({ left: 52, top: 120 });
  });

  test("keeps a popup it has not measured inside the viewport by assuming a height", async () => {
    const hook = renderSelectionDraft();

    placeElement(saveButton, { height: 20, width: 80, x: 100, y: 600 });
    holdAlt();
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

    holdAlt();
    await click(saveButton);
    await passAnimationFrame();

    // 768 - 400 - 10.
    expect(hook.result.current.popupCoordinates).toEqual({ left: 112, top: 358 });
  });
});
