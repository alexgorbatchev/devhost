import { describe, expect, test } from "bun:test";

import { scanTomlEntries } from "../scanTomlEntries";

describe("scanTomlEntries", () => {
  test("reads every table and key with its line and absolute path", () => {
    const text = [
      'name = "shop" # the label',
      "",
      "[services.web]",
      'command = ["bun", "dev"]',
      "health.http = 'http://web.localhost/'",
      "",
      '[services."api.v2".env]',
      'TOKEN = "x"',
    ].join("\n");

    expect(scanTomlEntries(text).entries.map(({ kind, line, path }) => ({ kind, line, path }))).toEqual([
      { kind: "key", line: 1, path: ["name"] },
      { kind: "table", line: 3, path: ["services", "web"] },
      { kind: "key", line: 4, path: ["services", "web", "command"] },
      { kind: "key", line: 5, path: ["services", "web", "health", "http"] },
      { kind: "table", line: 7, path: ["services", "api.v2", "env"] },
      { kind: "key", line: 8, path: ["services", "api.v2", "env", "TOKEN"] },
    ]);
  });

  test("numbers the elements of arrays of tables, including the tables inside them", () => {
    const text = [
      "[[annotation.actions]]",
      'id = "lint"',
      "[annotation.actions.command]",
      'command = ["bun", "lint"]',
      "[[annotation.actions]]",
      'id = "fix"',
    ].join("\n");

    expect(scanTomlEntries(text).entries.map(({ path }) => path)).toEqual([
      ["annotation", "actions[0]"],
      ["annotation", "actions[0]", "id"],
      ["annotation", "actions[0]", "command"],
      ["annotation", "actions[0]", "command", "command"],
      ["annotation", "actions[1]"],
      ["annotation", "actions[1]", "id"],
    ]);
  });

  test("skips values that span lines, so their contents are not read as keys", () => {
    const text = [
      'script = """',
      "fake = 1",
      '"""',
      "list = [",
      '  { name = "inline" },',
      "  # fake = 2",
      "]",
      "after = true",
    ].join("\n");

    expect(scanTomlEntries(text).entries.map(({ line, path }) => ({ line, path }))).toEqual([
      { line: 1, path: ["script"] },
      { line: 4, path: ["list"] },
      { line: 8, path: ["after"] },
    ]);
  });

  test("reports a value left open at the end, as while it is being typed", () => {
    expect(scanTomlEntries('list = [\n  "a",\n').isValueOpen).toBe(true);
    expect(scanTomlEntries("text = '''\nstill text").isValueOpen).toBe(true);
    expect(scanTomlEntries('list = ["a"]\n').isValueOpen).toBe(false);
  });

  test("gives the offsets of each key and table name", () => {
    const text = '[devtools.status]\n  position = "top-right"';
    const [table, key] = scanTomlEntries(text).entries;

    expect(text.slice(table?.from, table?.to)).toBe("devtools.status");
    expect(text.slice(key?.from, key?.to)).toBe("position");
  });

  test("ignores lines that are not complete keys or headers", () => {
    expect(scanTomlEntries("[services.web]\npo\n= 1\n[unclosed\nport = 1").entries.map(({ path }) => path)).toEqual([
      ["services", "web"],
      ["services", "web", "port"],
    ]);
  });
});
