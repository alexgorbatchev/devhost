import { describe, expect, test, vi } from "vitest";

import { captureTabSnapshot } from "../captureTabSnapshot";
import { createSharedTabFixture } from "./helpers";

describe("captureTabSnapshot", () => {
  test("cancels while hidden regions remain stale and releases only the snapshot clone", async () => {
    const fixture = createSharedTabFixture();
    const controller = new AbortController();
    const prepared = Promise.withResolvers<void>();
    const prepare = async () => {
      prepared.resolve();
      return [new DOMRect(0, 0, innerWidth, innerHeight)];
    };
    const pending = captureTabSnapshot({
      ...fixture,
      sharedStream: fixture.stream,
      signal: controller.signal,
      prepare,
    });
    try {
      await prepared.promise;
      await new Promise((resolve) => setTimeout(resolve, 150));
      controller.abort(new Error("Capture cancelled"));
      await expect(pending).rejects.toThrow("Capture cancelled");
      expect(fixture.track.readyState).toBe("live");
    } finally {
      fixture.track.stop();
    }
  });

  test("rejects queued pixels in every hidden region despite animation elsewhere", async () => {
    const fixture = createSharedTabFixture();
    const regions = [
      new DOMRect((10 * innerWidth) / 64, (10 * innerHeight) / 32, (8 * innerWidth) / 64, (8 * innerHeight) / 32),
      new DOMRect((30 * innerWidth) / 64, (10 * innerHeight) / 32, (8 * innerWidth) / 64, (8 * innerHeight) / 32),
    ];
    const prepare = async () => {
      fixture.context.fillStyle = "lime";
      fixture.context.fillRect(10, 10, 8, 8);
      setTimeout(() => {
        fixture.context.fillStyle = "lime";
        fixture.context.fillRect(30, 10, 8, 8);
      }, 400);
      return regions;
    };
    const snapshot = await captureTabSnapshot({ ...fixture, prepare });
    const bitmap = await createImageBitmap(await (await fetch(snapshot.dataUrl)).blob());
    try {
      fixture.context.drawImage(bitmap, 0, 0);
      expect(Array.from(fixture.context.getImageData(32, 12, 1, 1).data)).toEqual([0, 255, 0, 255]);
    } finally {
      bitmap.close();
    }
  });

  test("reuses an active share without opening a picker or stopping its track", async () => {
    const fixture = createSharedTabFixture();
    const picker = vi.spyOn(fixture.mediaDevices, "getDisplayMedia");
    const constraints = fixture.track.getConstraints();
    try {
      const snapshot = await captureTabSnapshot({ ...fixture, sharedStream: fixture.stream });
      expect(snapshot.width).toBe(64);
      expect(picker).not.toHaveBeenCalled();
      expect(fixture.stream.active).toBe(true);
      expect(fixture.track.getConstraints()).toEqual(constraints);
    } finally {
      fixture.track.stop();
    }
  });
  test("captures actual video pixels and releases the shared tab", async () => {
    const { stream, track, mediaDevices, document } = createSharedTabFixture();
    const stop = vi.spyOn(track, "stop");
    const prepare = vi.fn(async () => {});
    const snapshot = await captureTabSnapshot({ document, mediaDevices, prepare });

    expect(snapshot.width).toBe(64);
    expect(snapshot.height).toBe(32);
    const bitmap = await createImageBitmap(await (await fetch(snapshot.dataUrl)).blob());
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    expect(Array.from(context.getImageData(20, 10, 1, 1).data)).toEqual([255, 0, 0, 255]);
    bitmap.close();
    expect(prepare).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
    expect(stream.active).toBe(false);
  });

  test("opens the picker synchronously before preparing the UI", async () => {
    const fixture = createSharedTabFixture();
    const picker = vi.spyOn(fixture.mediaDevices, "getDisplayMedia");
    const prepare = vi.fn(async () => {});
    const pending = captureTabSnapshot({ ...fixture, prepare });
    expect(picker).toHaveBeenCalledOnce();
    expect(prepare).not.toHaveBeenCalled();
    await pending;
  });

  test("rejects a screen capture and stops it instead of sending unrelated pixels", async () => {
    const fixture = createSharedTabFixture();
    vi.spyOn(fixture.track, "getSettings").mockReturnValue({ displaySurface: "monitor" });
    const prepare = vi.fn(async () => {});
    await expect(captureTabSnapshot({ ...fixture, prepare })).rejects.toThrow(
      "Select this browser tab to include the page and its annotations.",
    );
    expect(fixture.stream.active).toBe(false);
    expect(prepare).not.toHaveBeenCalled();
  });

  test("propagates permission cancellation without preparing a capture", async () => {
    const fixture = createSharedTabFixture();
    fixture.track.stop();
    vi.spyOn(fixture.mediaDevices, "getDisplayMedia").mockRejectedValue(
      new DOMException("Sharing cancelled", "NotAllowedError"),
    );
    const prepare = vi.fn(async () => {});
    await expect(captureTabSnapshot({ ...fixture, prepare })).rejects.toThrow("Sharing cancelled");
    expect(prepare).not.toHaveBeenCalled();
  });

  test("releases capture when preparing the page fails", async () => {
    const fixture = createSharedTabFixture();
    const prepare = vi.fn().mockRejectedValue(new Error("Page changed"));
    await expect(captureTabSnapshot({ ...fixture, prepare })).rejects.toThrow("Page changed");
    expect(fixture.stream.active).toBe(false);
  });

  test("releases a stream granted after the caller has cancelled", async () => {
    const fixture = createSharedTabFixture();
    const controller = new AbortController();
    const prepare = vi.fn(async () => {});
    const pending = captureTabSnapshot({ ...fixture, prepare, signal: controller.signal });
    controller.abort(new Error("Capture cancelled"));
    await expect(pending).rejects.toThrow("Capture cancelled");
    expect(fixture.stream.active).toBe(false);
    expect(prepare).not.toHaveBeenCalled();
  });
});
