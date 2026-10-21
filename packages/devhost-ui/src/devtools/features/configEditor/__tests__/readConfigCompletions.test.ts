import { describe, expect, test } from "bun:test";

import { readConfigCompletions } from "../readConfigCompletions";
import { fixture_manifestSchema } from "./fixtures";

describe("readConfigCompletions", () => {
  test("offers the keys of the table the cursor is in", () => {
    expect(
      readConfigCompletions(fixture_manifestSchema, {
        from: 4,
        kind: "key",
        parentPath: [],
        tablePath: ["services", "web"],
        text: "po",
      }),
    ).toEqual({
      from: 4,
      options: [
        { apply: "command", kind: "key", label: "command" },
        { apply: "health", kind: "table", label: "health" },
        { apply: "lifecycle", kind: "table", label: "lifecycle" },
        { apply: "port", kind: "key", label: "port" },
      ],
    });
  });

  test("offers the keys of a table named by a dotted key", () => {
    expect(
      readConfigCompletions(fixture_manifestSchema, {
        from: 7,
        kind: "key",
        parentPath: ["health"],
        tablePath: ["services", "web"],
        text: "",
      })?.options.map((option) => option.label),
    ).toEqual(["http", "tcp"]);
  });

  test("offers the keys of an element of an array of tables", () => {
    expect(
      readConfigCompletions(fixture_manifestSchema, {
        from: 0,
        kind: "key",
        parentPath: [],
        tablePath: ["annotation", "actions[1]"],
        text: "",
      })?.options.map((option) => option.label),
    ).toEqual(["command", "id", "kind", "label"]);
  });

  test("offers only tables in a table header", () => {
    expect(
      readConfigCompletions(fixture_manifestSchema, { from: 1, kind: "header", parentPath: [], text: "" })?.options.map(
        (option) => option.label,
      ),
    ).toEqual(["annotation", "devtools", "services"]);
    expect(
      readConfigCompletions(fixture_manifestSchema, { from: 10, kind: "header", parentPath: ["devtools"], text: "" }),
    ).toEqual({
      from: 10,
      options: [
        { apply: "configEditor", kind: "table", label: "configEditor" },
        { apply: "status", kind: "table", label: "status" },
      ],
    });
  });

  test("offers the values a setting accepts, quoted when the value has no quote yet", () => {
    const keyPath: string[] = ["services", "web", "lifecycle", "mode"];

    expect(
      readConfigCompletions(fixture_manifestSchema, { from: 7, isQuoted: false, keyPath, kind: "value", text: "" }),
    ).toEqual({
      from: 7,
      options: [
        { apply: '"foreground"', kind: "value", label: "foreground" },
        { apply: '"daemon"', kind: "value", label: "daemon" },
      ],
    });
    expect(
      readConfigCompletions(fixture_manifestSchema, { from: 8, isQuoted: true, keyPath, kind: "value", text: "d" })
        ?.options[1],
    ).toEqual({ apply: "daemon", kind: "value", label: "daemon" });
  });

  test.each([
    ["a name the manifest chooses", { from: 10, kind: "header" as const, parentPath: ["services"], text: "" }],
    ["a table without a schema", { from: 0, kind: "key" as const, parentPath: [], tablePath: ["groups"], text: "" }],
    [
      "a setting without fixed values",
      { from: 0, isQuoted: true, keyPath: ["name"], kind: "value" as const, text: "" },
    ],
    ["no context", { kind: "none" as const }],
  ])("offers nothing for %s", (_name, context) => {
    expect(readConfigCompletions(fixture_manifestSchema, context)).toBeNull();
  });
});
