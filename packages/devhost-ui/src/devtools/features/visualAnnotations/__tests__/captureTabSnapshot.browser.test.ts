import { describe, expect, test, vi } from "vitest";

import { captureTabSnapshot } from "../captureTabSnapshot";
import { createSharedTabFixture } from "./helpers";

describe("captureTabSnapshot", () => {
  test("reuses an active share without opening a picker or stopping its track", async () => {
    const fixture = createSharedTabFixture();
    const picker = vi.spyOn(fixture.mediaDevices, "getDisplayMedia");
    try {
      const snapshot = await captureTabSnapshot({ ...fixture, sharedStream: fixture.stream, prepare: async () => {} });
      expect(snapshot.width).toBe(64);
      expect(picker).not.toHaveBeenCalled();
      expect(fixture.stream.active).toBe(true);
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
