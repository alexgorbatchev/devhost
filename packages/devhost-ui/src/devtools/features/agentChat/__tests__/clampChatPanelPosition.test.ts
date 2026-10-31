import { expect, test } from "bun:test";
import { clampChatPanelPosition } from "../clampChatPanelPosition";

const header = { width: 400, height: 40 };
const viewport = { width: 1000, height: 800 };

test("leaves a position inside the viewport alone", () => {
  expect(clampChatPanelPosition({ left: 100, top: 200 }, header, viewport)).toEqual({ left: 100, top: 200 });
});

test("pulls a position saved on a larger screen back into view", () => {
  expect(clampChatPanelPosition({ left: 1800, top: 1200 }, header, viewport)).toEqual({ left: 600, top: 760 });
});

test("keeps the top left corner on screen", () => {
  expect(clampChatPanelPosition({ left: -50, top: -50 }, header, viewport)).toEqual({ left: 0, top: 0 });
});

test("a panel wider than the viewport stays at its edge", () => {
  const wide = { width: 1200, height: 40 };
  expect(clampChatPanelPosition({ left: 100, top: 0 }, wide, viewport)).toEqual({ left: 0, top: 0 });
});
