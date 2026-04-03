export const supportedDevtoolsComponentEditors = ["cursor", "neovim", "vscode", "vscode-insiders", "webstorm"] as const;

export type DevtoolsComponentEditor = (typeof supportedDevtoolsComponentEditors)[number];

export const defaultDevtoolsComponentEditor: DevtoolsComponentEditor = "vscode";

export function isDevtoolsComponentEditor(value: unknown): value is DevtoolsComponentEditor {
  return (
    value === "cursor" ||
    value === "neovim" ||
    value === "vscode" ||
    value === "vscode-insiders" ||
    value === "webstorm"
  );
}

export function readDevtoolsComponentEditorValue(value: unknown): DevtoolsComponentEditor {
  return isDevtoolsComponentEditor(value) ? value : defaultDevtoolsComponentEditor;
}

export function readDevtoolsComponentEditorLabel(editor: DevtoolsComponentEditor): string {
  switch (editor) {
    case "cursor":
      return "Cursor";
    case "neovim":
      return "Neovim";
    case "vscode-insiders":
      return "VS Code Insiders";
    case "webstorm":
      return "WebStorm";
    case "vscode":
    default:
      return "VS Code";
  }
}
