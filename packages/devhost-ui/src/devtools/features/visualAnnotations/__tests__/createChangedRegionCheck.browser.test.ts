import { expect, test } from "vitest";
import { createChangedRegionCheck } from "../createChangedRegionCheck";

test("maps clipped viewport regions to video pixels and ignores encoding noise and unrelated animation", () => {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 32;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "rgb(100, 100, 100)";
  context.fillRect(0, 0, 64, 32);
  const before = context.getImageData(0, 0, 64, 32);
  const hasChanged = createChangedRegionCheck(context, before, [new DOMRect(-20, -20, 40, 40)], 128, 64);
  expect(hasChanged()).toBe(false);
  context.fillStyle = "lime";
  context.fillRect(40, 20, 20, 10);
  expect(hasChanged()).toBe(false);
  context.fillStyle = "rgb(102, 102, 102)";
  context.fillRect(0, 0, 10, 10);
  expect(hasChanged()).toBe(false);
  context.fillStyle = "lime";
  context.fillRect(0, 0, 10, 10);
  expect(hasChanged()).toBe(true);
});

test("does not wait for offscreen or zero-area regions", () => {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 32;
  const context = canvas.getContext("2d")!;
  const before = context.getImageData(0, 0, 64, 32);
  const hasChanged = createChangedRegionCheck(
    context,
    before,
    [new DOMRect(128, 64, 10, 10), new DOMRect(-20, -20, 5, 5), new DOMRect(1, 1, 0, 5)],
    128,
    64,
  );
  expect(hasChanged()).toBe(true);
});
