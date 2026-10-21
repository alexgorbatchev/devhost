import { expect, test, vi } from "vitest";
import { captureAnnotatedTab } from "../captureAnnotatedTab";
import { createChatCaptureFixture, createSharedTabFixture } from "./helpers";
import { createDomAnnotationSelectionCandidateForElement } from "../../annotationComposer/createDomAnnotationSelectionCandidateForElement";

test("keeps annotated chat visible while sampling and still hides annotation tools", async () => {
  const fixture = createChatCaptureFixture();
  const { root, chat, tools } = fixture;
  const capture = captureAnnotatedTab({
    ...fixture,
    root,
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

test("opens the tab picker immediately, hides chrome while sampling and restores it", async () => {
  const fixture = createSharedTabFixture();
  const root = document.createElement("div");
  document.body.append(root);
  const picker = vi.spyOn(fixture.mediaDevices, "getDisplayMedia");
  const hidden = Promise.withResolvers<void>();
  const observer = new MutationObserver(() => hidden.resolve());
  observer.observe(root, { attributes: true, attributeFilter: ["data-devhost-capturing"] });
  const capture = captureAnnotatedTab({ ...fixture, root });
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

test("keeps a selected chat control visible during capture and restores visibility after cancellation", async () => {
  const fixture = createChatCaptureFixture();
  const { root, chat, button } = fixture;
  const controller = new AbortController();
  const capture = captureAnnotatedTab({
    ...fixture,
    root,
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
  const capture = captureAnnotatedTab({ ...fixture, root, signal: controller.signal });
  await Promise.resolve();
  controller.abort(new Error("Chat unmounted"));
  await expect(capture).rejects.toThrow("Chat unmounted");
  expect(root.hasAttribute("data-devhost-capturing")).toBe(false);
  expect(fixture.stream.active).toBe(false);
});
