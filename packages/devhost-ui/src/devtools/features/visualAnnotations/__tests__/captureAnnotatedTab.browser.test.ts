import { expect, test, vi } from "vitest";
import { captureAnnotatedTab } from "../captureAnnotatedTab";
import { createChatCaptureFixture, createSharedTabFixture } from "./helpers";
import { createDomAnnotationSelectionCandidateForElement } from "../../annotationComposer/createDomAnnotationSelectionCandidateForElement";
import { placeElement } from "../../../../../test-support/hostPageUtils";

test.each([
  ["role", "tooltip"],
  ["data-slot", "tooltip-content"],
])("hides a portaled %s tooltip even when annotated chat stays visible, then restores it", async (attribute, value) => {
  const fixture = createChatCaptureFixture();
  const tooltip = document.createElement("div");
  tooltip.setAttribute(attribute, value);
  tooltip.textContent = "Send Message";
  placeElement(tooltip, { x: 140, y: 150, width: 120, height: 30 });
  fixture.root.append(tooltip);
  const capture = captureAnnotatedTab({
    ...fixture,
    shouldKeepAnnotatedSurfaces: true,
    shapes: [{ id: "box", kind: "box", start: { x: 130, y: 130 }, end: { x: 280, y: 230 } }],
  });
  try {
    await fixture.sampling;
    fixture.observer.disconnect();
    expect(getComputedStyle(fixture.chat).visibility).toBe("visible");
    expect(getComputedStyle(tooltip).visibility).toBe("hidden");
  } finally {
    await capture;
  }
  expect(getComputedStyle(tooltip).visibility).toBe("visible");
});

test("retains an annotated native popover outside the bounds of its hidden devtools ancestor", async () => {
  const fixture = createChatCaptureFixture();
  const popover = document.createElement("section");
  popover.popover = "auto";
  placeElement(popover, { x: 400, y: 20, width: 200, height: 60 });
  const button = document.createElement("button");
  button.textContent = "Native popover target";
  placeElement(button, { x: 420, y: 30, width: 160, height: 30 });
  popover.append(button);
  fixture.chat.append(popover);
  popover.showPopover();
  const capture = captureAnnotatedTab({
    ...fixture,
    shouldKeepAnnotatedSurfaces: true,
    selectedTargets: [
      { markerNumber: 1, candidate: createDomAnnotationSelectionCandidateForElement({ element: button }) },
    ],
  });
  try {
    await fixture.sampling;
    fixture.observer.disconnect();
    expect(getComputedStyle(fixture.chat).visibility).toBe("hidden");
    expect(getComputedStyle(button).visibility).toBe("visible");
    expect(popover.matches(":popover-open")).toBe(true);
    await capture;
    expect(getComputedStyle(button).visibility).toBe("visible");
  } finally {
    await capture;
    popover.hidePopover();
  }
});

test("keeps annotated chat visible while sampling and still hides annotation tools", async () => {
  const fixture = createChatCaptureFixture();
  const { root, chat, tools } = fixture;
  const capture = captureAnnotatedTab({
    ...fixture,
    root,
    shouldKeepAnnotatedSurfaces: true,
    shapes: [{ id: "box", kind: "box", start: { x: 130, y: 130 }, end: { x: 230, y: 230 } }],
  });
  await fixture.sampling;
  fixture.observer.disconnect();
  expect(getComputedStyle(chat).visibility).toBe("visible");
  expect(getComputedStyle(tools).visibility).toBe("hidden");
  await capture;
  expect(getComputedStyle(chat).visibility).toBe("visible");
  expect(getComputedStyle(tools).visibility).toBe("visible");
  expect(root.querySelector("[data-devhost-capture-include]")).toBeNull();
});

test("hides devhost surfaces under annotations when devhost UI is not annotated", async () => {
  const fixture = createChatCaptureFixture();
  const { root, chat, tools } = fixture;
  const capture = captureAnnotatedTab({
    ...fixture,
    root,
    shouldKeepAnnotatedSurfaces: false,
    shapes: [{ id: "box", kind: "box", start: { x: 130, y: 130 }, end: { x: 230, y: 230 } }],
  });
  await fixture.sampling;
  fixture.observer.disconnect();
  expect(getComputedStyle(chat).visibility).toBe("hidden");
  expect(getComputedStyle(tools).visibility).toBe("hidden");
  await capture;
  expect(getComputedStyle(chat).visibility).toBe("visible");
  expect(root.querySelector("[data-devhost-capture-include]")).toBeNull();
});

test("opens the tab picker immediately, hides chrome while sampling and restores it", async () => {
  const fixture = createSharedTabFixture();
  const root = document.createElement("div");
  document.body.append(root);
  const picker = vi.spyOn(fixture.mediaDevices, "getDisplayMedia");
  const hidden = Promise.withResolvers<void>();
  const observer = new MutationObserver(() => hidden.resolve());
  observer.observe(root, { attributes: true, attributeFilter: ["data-devhost-capturing"] });
  const capture = captureAnnotatedTab({ ...fixture, root, shouldKeepAnnotatedSurfaces: true });
  expect(picker).toHaveBeenCalledOnce();
  await hidden.promise;
  observer.disconnect();
  expect(root.hasAttribute("data-devhost-capturing")).toBe(true);
  const snapshot = await capture;
  expect(snapshot.width).toBe(64);
  expect(root.hasAttribute("data-devhost-capturing")).toBe(false);
  expect(fixture.stream.active).toBe(false);
  root.remove();
});

test("does not wait for pixels from an already transparent devhost surface", async () => {
  const fixture = createSharedTabFixture();
  const root = document.createElement("div");
  const surface = document.createElement("aside");
  surface.setAttribute("data-devhost-capture-exclude", "");
  surface.style.opacity = "0";
  placeElement(surface, { x: 100, y: 100, width: 100, height: 100 });
  root.append(surface);
  document.body.append(root);
  const snapshot = await captureAnnotatedTab({ ...fixture, root, shouldKeepAnnotatedSurfaces: false });
  expect(snapshot.width).toBe(64);
  expect(fixture.track.readyState).toBe("ended");
  expect(root.hasAttribute("data-devhost-capturing")).toBe(false);
});

test("keeps a selected chat control visible during capture and restores visibility after cancellation", async () => {
  const fixture = createChatCaptureFixture();
  const { root, chat, button } = fixture;
  const controller = new AbortController();
  const capture = captureAnnotatedTab({
    ...fixture,
    root,
    shouldKeepAnnotatedSurfaces: true,
    signal: controller.signal,
    selectedTargets: [
      { markerNumber: 1, candidate: createDomAnnotationSelectionCandidateForElement({ element: button }) },
    ],
  });
  await fixture.sampling;
  fixture.observer.disconnect();
  expect(getComputedStyle(button).visibility).toBe("visible");
  controller.abort(new Error("Chat unmounted"));
  await expect(capture).rejects.toThrow("Chat unmounted");
  expect(root.hasAttribute("data-devhost-capturing")).toBe(false);
  expect(root.querySelector("[data-devhost-capture-include]")).toBeNull();
  expect(getComputedStyle(chat).visibility).toBe("visible");
  expect(fixture.stream.active).toBe(false);
});

test("aborting before the next paint releases capture and restores chrome", async () => {
  const fixture = createSharedTabFixture();
  const root = document.createElement("div");
  const controller = new AbortController();
  const capture = captureAnnotatedTab({
    ...fixture,
    root,
    shouldKeepAnnotatedSurfaces: true,
    signal: controller.signal,
  });
  await Promise.resolve();
  controller.abort(new Error("Chat unmounted"));
  await expect(capture).rejects.toThrow("Chat unmounted");
  expect(root.hasAttribute("data-devhost-capturing")).toBe(false);
  expect(fixture.stream.active).toBe(false);
});
