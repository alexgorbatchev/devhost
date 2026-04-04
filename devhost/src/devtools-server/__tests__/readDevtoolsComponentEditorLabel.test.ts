import { describe, expect, test } from "bun:test";

import { readDevtoolsComponentEditorLabel } from "../devtoolsComponentEditor";

describe("readDevtoolsComponentEditorLabel", () => {
  test("returns the human-readable editor names used by devtools UI", () => {
    expect(readDevtoolsComponentEditorLabel("cursor")).toBe("Cursor");
    expect(readDevtoolsComponentEditorLabel("neovim")).toBe("Neovim");
    expect(readDevtoolsComponentEditorLabel("vscode")).toBe("VS Code");
    expect(readDevtoolsComponentEditorLabel("vscode-insiders")).toBe("VS Code Insiders");
    expect(readDevtoolsComponentEditorLabel("webstorm")).toBe("WebStorm");
  });
});
