import { expect, test } from "vitest";
import { cropTabSnapshot } from "../cropTabSnapshot";
import { createScreenshotFixture } from "../../../../../test-support/createScreenshotFixture";

test("encodes only selected pixels and retains the original image coordinates", async () => {
  const source = createScreenshotFixture();
  const snapshot = await cropTabSnapshot(source, { x: 32, y: 16, width: 16, height: 8 }, document);
  expect(snapshot.width).toBe(16);
  expect(snapshot.height).toBe(8);
  expect(snapshot.crop).toEqual({ x: 32, y: 16, width: 16, height: 8, sourceWidth: 64, sourceHeight: 32 });
  const bitmap = await createImageBitmap(await (await fetch(snapshot.dataUrl)).blob());
  try {
    expect(bitmap.width).toBe(16);
    expect(bitmap.height).toBe(8);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, 16, 8).data;
    expect(Array.from(pixels)).toEqual(Array.from({ length: 16 * 8 }, () => [0, 255, 0, 255]).flat());
  } finally {
    bitmap.close();
  }
});

test("clips a partially off-image selection to its real pixel bounds", async () => {
  const snapshot = await cropTabSnapshot(createScreenshotFixture(), { x: 60, y: 30, width: 20, height: 20 }, document);
  expect(snapshot.crop).toEqual({ x: 60, y: 30, width: 4, height: 2, sourceWidth: 64, sourceHeight: 32 });
  expect(snapshot.width).toBe(4);
  expect(snapshot.height).toBe(2);
});

test.each([
  { x: 10, y: 10, width: 0, height: 20 },
  { x: 100, y: 100, width: 10, height: 10 },
  { x: Number.NaN, y: 0, width: 10, height: 10 },
])("rejects an unusable crop before encoding: %j", async (area) => {
  await expect(cropTabSnapshot(createScreenshotFixture(), area, document)).rejects.toThrow(
    "Select an area inside the screenshot.",
  );
});

test("rejects metadata that would crop a differently sized image", async () => {
  await expect(
    cropTabSnapshot({ ...createScreenshotFixture(), width: 128 }, { x: 0, y: 0, width: 10, height: 10 }, document),
  ).rejects.toThrow("The screenshot dimensions do not match its image.");
});
