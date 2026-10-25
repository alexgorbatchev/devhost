import { expect, test } from "bun:test";
import { getScreenshotArea } from "../getScreenshotArea";

test("normalizes a reverse drag, rounds pixels outward, and clips the image edges", () => {
  expect(getScreenshotArea({ x: 90.2, y: 50 }, { x: -4, y: 10.2 }, { width: 64, height: 32 })).toEqual({
    x: 0,
    y: 10,
    width: 64,
    height: 22,
  });
  expect(getScreenshotArea({ x: 10.2, y: 4.2 }, { x: 20.8, y: 9.8 }, { width: 64, height: 32 })).toEqual({
    x: 10,
    y: 4,
    width: 11,
    height: 6,
  });
});

test("ignores clicks, non-finite points, and drags outside the image", () => {
  expect(getScreenshotArea({ x: 10.2, y: 2 }, { x: 10.2, y: 8 }, { width: 64, height: 32 })).toBeNull();
  expect(getScreenshotArea({ x: Number.NaN, y: 2 }, { x: 20, y: 8 }, { width: 64, height: 32 })).toBeNull();
  expect(getScreenshotArea({ x: 100, y: 60 }, { x: 200, y: 100 }, { width: 64, height: 32 })).toBeNull();
});
