import { describe, expect, test } from "bun:test";
import { preparePageChatSend } from "../preparePageChatSend";
import type { ITabSnapshot } from "../../visualAnnotations/types";

describe("preparePageChatSend", () => {
  test("keeps plain chat unchanged without opening capture", async () => {
    const result = await preparePageChatSend({
      text: "Hello",
      title: "Page",
      url: "https://app.localhost/",
      targets: [],
      shapes: [],
    });
    expect(result).toEqual({ text: "Hello" });
  });
  test("sends drawings without requiring a tab snapshot", async () => {
    const shape = { id: "arrow-1", kind: "arrow" as const, start: { x: 10, y: 20 }, end: { x: 30, y: 40 } };
    const result = await preparePageChatSend({
      text: "Move this",
      title: "Page",
      url: "https://app.localhost/",
      targets: [],
      shapes: [shape],
    });
    expect(result).toEqual({
      text: `Move this\n\nPage context:\n${JSON.stringify({ title: "Page", url: "https://app.localhost/", markers: [], shapes: [shape] })}`,
    });
  });
  test("captures an explicitly included snapshot without annotations", async () => {
    const result = await preparePageChatSend({
      text: "Review",
      title: "Page",
      url: "https://app.localhost/",
      targets: [],
      shapes: [],
      capture: async () => ({ dataUrl: "data:image/png;base64,cGl4ZWxz", width: 640, height: 480 }),
    });
    expect(result).toEqual({
      text: `Review\n\nPage context:\n${JSON.stringify({ title: "Page", url: "https://app.localhost/", markers: [], shapes: [], screenshot: { width: 640, height: 480 } })}`,
      images: [{ dataURL: "data:image/png;base64,cGl4ZWxz" }],
    });
  });
  test("opens capture before asynchronous marker resolution and includes actual drawings", async () => {
    const calls: string[] = [];
    const shape = { id: "arrow-1", kind: "arrow" as const, start: { x: 10, y: 20 }, end: { x: 30, y: 40 } };
    const resultPromise = preparePageChatSend({
      text: "Move this",
      title: "Page",
      url: "https://app.localhost/",
      targets: [],
      shapes: [shape],
      capture: async () => {
        calls.push("capture");
        return { dataUrl: "data:image/png;base64,cGl4ZWxz", width: 640, height: 480 };
      },
    });
    expect(calls).toEqual(["capture"]);
    const result = await resultPromise;
    expect(result.images).toEqual([{ dataURL: "data:image/png;base64,cGl4ZWxz" }]);
    expect(result.text).toBe(
      `Move this\n\nPage context:\n${JSON.stringify({ title: "Page", url: "https://app.localhost/", markers: [], shapes: [shape], screenshot: { width: 640, height: 480 } })}`,
    );
  });
  test("does not silently send context when sharing is cancelled", async () => {
    const shape = { id: "line-1", kind: "line" as const, start: { x: 1, y: 2 }, end: { x: 3, y: 4 } };
    await expect(
      preparePageChatSend({
        text: "Fix",
        title: "Page",
        url: "https://app.localhost/",
        targets: [],
        shapes: [shape],
        capture: () => Promise.reject(new Error("Sharing cancelled")),
      }),
    ).rejects.toThrow("Sharing cancelled");
  });
  test("waits for area confirmation and sends only the cropped image with its source bounds", async () => {
    const selected = Promise.withResolvers<ITabSnapshot>();
    const previewed = Promise.withResolvers<void>();
    const pending = preparePageChatSend({
      text: "Review this area",
      title: "Page",
      url: "https://app.localhost/",
      targets: [],
      shapes: [],
      capture: async () => ({ dataUrl: "full image", width: 640, height: 480 }),
      selectSnapshot: (snapshot) => {
        expect(snapshot).toEqual({ dataUrl: "full image", width: 640, height: 480 });
        previewed.resolve();
        return selected.promise;
      },
    });
    await previewed.promise;
    const crop = { x: 20, y: 30, width: 100, height: 80, sourceWidth: 640, sourceHeight: 480 };
    selected.resolve({ dataUrl: "cropped image", width: 100, height: 80, crop });
    expect(await pending).toEqual({
      text: `Review this area\n\nPage context:\n${JSON.stringify({ title: "Page", url: "https://app.localhost/", markers: [], shapes: [], screenshot: { width: 100, height: 80, crop } })}`,
      images: [{ dataURL: "cropped image" }],
    });
  });
});
