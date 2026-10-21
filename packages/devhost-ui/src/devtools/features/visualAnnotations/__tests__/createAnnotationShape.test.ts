import { describe, expect, test } from "bun:test";

import { createAnnotationShape } from "../createAnnotationShape";

describe("createAnnotationShape", () => {
  test("keeps an arrow's direction when dragged backwards", () => {
    expect(createAnnotationShape("a", "arrow", { x: 200, y: 300 }, { x: 20, y: 40 })).toEqual({
      id: "a",
      kind: "arrow",
      start: { x: 200, y: 300 },
      end: { x: 20, y: 40 },
    });
  });
  test("normalizes a reverse-drawn box", () => {
    expect(createAnnotationShape("b", "box", { x: 200, y: 300 }, { x: 20, y: 40 })).toEqual({
      id: "b",
      kind: "box",
      start: { x: 20, y: 40 },
      end: { x: 200, y: 300 },
    });
  });
  test("discards accidental clicks rather than creating invisible shapes", () => {
    expect(createAnnotationShape("c", "line", { x: 20, y: 40 }, { x: 21, y: 41 })).toBeNull();
  });
  test("rejects a box without area but permits a horizontal line", () => {
    expect(createAnnotationShape("d", "box", { x: 20, y: 40 }, { x: 80, y: 40 })).toBeNull();
    expect(createAnnotationShape("e", "line", { x: 20, y: 40 }, { x: 80, y: 40 })).toEqual({
      id: "e",
      kind: "line",
      start: { x: 20, y: 40 },
      end: { x: 80, y: 40 },
    });
  });
});
