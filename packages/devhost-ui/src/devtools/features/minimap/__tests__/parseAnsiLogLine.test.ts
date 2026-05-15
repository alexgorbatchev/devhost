import { describe, expect, test } from "bun:test";

import { parseAnsiLogLine } from "../parseAnsiLogLine";

describe("parseAnsiLogLine", () => {
  test("preserves ANSI styling without leaking escape sequences into parsed text", () => {
    expect(parseAnsiLogLine("\u001b[38;2;12;34;56mABCDEFGH\u001b[0m")).toEqual({
      fragments: [
        {
          backgroundColor: null,
          foregroundColor: "rgb(12, 34, 56)",
          isBold: false,
          isDim: false,
          isItalic: false,
          isStrikethrough: false,
          isUnderline: false,
          text: "ABCDEFGH",
        },
      ],
      text: "ABCDEFGH",
    });
  });
});
