import { expect, test, vi } from "vitest";
import { captureAnnotatedTab } from "../captureAnnotatedTab";
import { createSharedTabFixture } from "./helpers";

test("opens the tab picker immediately, hides chrome while sampling and restores it", async () => {
  const fixture = createSharedTabFixture();
  const root = document.createElement("div");
  document.body.append(root);
  const picker = vi.spyOn(fixture.mediaDevices, "getDisplayMedia");
  const capture = captureAnnotatedTab({ ...fixture, root });
  expect(picker).toHaveBeenCalledOnce();
  await Promise.resolve();
  expect(root.hasAttribute("data-devhost-capturing")).toBe(true);
  const snapshot = await capture;
  expect(snapshot.width).toBe(64);
  expect(root.hasAttribute("data-devhost-capturing")).toBe(false);
  expect(fixture.stream.active).toBe(false);
  root.remove();
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
