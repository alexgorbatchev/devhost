import { describe, expect, test } from "bun:test";

import { isEventTargetTerminalKeyboardInput } from "../isEventTargetTerminalKeyboardInput";

type TokenContainsFunction = (token: string) => boolean;

describe("isEventTargetTerminalKeyboardInput", () => {
  test("returns true for the xterm helper textarea", () => {
    expect(
      isEventTargetTerminalKeyboardInput(
        createEventTargetWithDomShape("textarea", (token: string): boolean => token === "xterm-helper-textarea"),
      ),
    ).toBe(true);
  });

  test("returns false for regular textareas", () => {
    expect(isEventTargetTerminalKeyboardInput(createEventTargetWithDomShape("TEXTAREA", (): boolean => false))).toBe(
      false,
    );
  });

  test("returns false for non-textarea targets", () => {
    expect(
      isEventTargetTerminalKeyboardInput(
        createEventTargetWithDomShape("DIV", (token: string): boolean => token === "xterm-helper-textarea"),
      ),
    ).toBe(false);
  });
});

function createEventTargetWithDomShape(tagName: string, contains: TokenContainsFunction): EventTarget {
  return Object.assign(new EventTarget(), {
    classList: {
      contains,
    },
    tagName,
  });
}
