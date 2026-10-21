import { describe, expect, test } from "bun:test";

import { readTomlCursorContext } from "../readTomlCursorContext";

// The cursor sits where the text has "|".
function readContextAtMarker(textWithMarker: string): ReturnType<typeof readTomlCursorContext> {
  const offset: number = textWithMarker.indexOf("|");

  return readTomlCursorContext(textWithMarker.replace("|", ""), offset);
}

describe("readTomlCursorContext", () => {
  test("reads a key being typed in the table above it", () => {
    expect(readContextAtMarker('name = "shop"\n[services.web]\nhealth.ht|')).toEqual({
      from: 36,
      kind: "key",
      parentPath: ["health"],
      tablePath: ["services", "web"],
      text: "ht",
    });
  });

  test("reads a key on an empty line of the root table", () => {
    expect(readContextAtMarker("  |")).toEqual({ from: 2, kind: "key", parentPath: [], tablePath: [], text: "" });
  });

  test("reads a table header being typed", () => {
    expect(readContextAtMarker("[services.web]\n[devtools.sta|")).toEqual({
      from: 25,
      kind: "header",
      parentPath: ["devtools"],
      text: "sta",
    });
  });

  test("reads a value being typed, quoted or not", () => {
    expect(readContextAtMarker('[devtools.status]\nposition = "top|')).toEqual({
      from: 30,
      isQuoted: true,
      keyPath: ["devtools", "status", "position"],
      kind: "value",
      text: "top",
    });
    expect(readContextAtMarker("[services.web.lifecycle]\nmode = da|")).toEqual({
      from: 32,
      isQuoted: false,
      keyPath: ["services", "web", "lifecycle", "mode"],
      kind: "value",
      text: "da",
    });
  });

  test("places a key inside an element of an array of tables", () => {
    expect(readContextAtMarker('[[annotation.actions]]\nid = "lint"\n[[annotation.actions]]\nla|')).toMatchObject({
      tablePath: ["annotation", "actions[1]"],
    });
  });

  test.each([
    ["a comment", "# na|"],
    ["a closed value", 'name = "shop"|'],
    ["a closed header", "[services]|"],
    ["the inside of an open array", "list = [\n  |"],
    ["a line that is no key", "a b|"],
  ])("offers nothing in %s", (_name: string, text: string) => {
    expect(readContextAtMarker(text)).toEqual({ kind: "none" });
  });
});
