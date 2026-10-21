import { describe, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { preparePageChatSend } from "../preparePageChatSend";

describe("preparePageChatSend", () => {
  test("keeps plain chat unchanged without opening capture", async () => {
    const calls: string[] = [];
    const result = await preparePageChatSend({
      text: "Hello",
      title: "Page",
      url: "https://app.localhost/",
      targets: [],
      shapes: [],
      capture: async () => {
        calls.push("capture");
        assert.fail("Unexpected capture");
      },
    });
    expect(result).toEqual({ text: "Hello" });
    expect(calls).toEqual([]);
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
    expect(result.text).toContain("Move this");
    expect(result.text).toContain(JSON.stringify(shape));
    expect(result.text).toContain("https://app.localhost/");
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
});
