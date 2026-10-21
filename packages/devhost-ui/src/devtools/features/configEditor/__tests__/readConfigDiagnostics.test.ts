import { describe, expect, test } from "bun:test";

import { readConfigDiagnostics } from "../readConfigDiagnostics";
import type { IConfigDiagnostic } from "../types";

const filePath: string = "/projects/shop/devhost.toml";
const text: string = [
  'name = "shop"',
  "",
  "[services.api]",
  "port = 0",
  "",
  "[[annotation.actions]]",
  'id = "lint"',
].join("\n");

function readMarkedText(diagnostic: IConfigDiagnostic | undefined): string {
  return text.slice(diagnostic?.from, diagnostic?.to);
}

describe("readConfigDiagnostics", () => {
  test("marks the character a syntax error names", () => {
    const [diagnostic] = readConfigDiagnostics([{ column: 8, line: 4, message: "unexpected" }], text, filePath);

    expect(diagnostic).toEqual({ from: 37, message: "unexpected", to: 38 });
    expect(readMarkedText(diagnostic)).toBe("0");
  });

  test("marks the key or table a validation issue names", () => {
    const diagnostics: IConfigDiagnostic[] = readConfigDiagnostics(
      [
        { keyPath: "services.api.port", message: "services.api.port must be an integer" },
        { keyPath: "annotation.actions[0].id", message: "annotation.actions[0].id is taken" },
        { keyPath: "services.api.missing", message: "services.api.missing is required" },
      ],
      text,
      filePath,
    );

    expect(diagnostics.map(readMarkedText)).toEqual(["port", "id", "services.api"]);
  });

  test("marks the start of the file for an issue it cannot place", () => {
    expect(
      readConfigDiagnostics(
        [
          { message: "Dependency cycle detected: api -> api" },
          { keyPath: "services.web.port", message: "services.web.port is taken" },
          { column: 2, line: 1, message: "Failed to parse api.toml", path: "/projects/shop/api.toml" },
        ],
        text,
        filePath,
      ),
    ).toEqual([
      { from: 0, message: "Dependency cycle detected: api -> api", to: 0 },
      { from: 0, message: "services.web.port is taken", to: 0 },
      { from: 0, message: "Failed to parse api.toml", to: 0 },
    ]);
  });

  test("keeps a position past the end of its line on that line", () => {
    expect(readConfigDiagnostics([{ column: 40, line: 1, message: "too far" }], text, filePath)).toEqual([
      { from: 13, message: "too far", to: 13 },
    ]);
  });
});
