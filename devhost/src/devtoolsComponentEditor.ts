export const supportedDevtoolsComponentEditors = [
  "cursor",
  "vscode",
  "vscode-insiders",
  "webstorm",
] as const;

export type DevtoolsComponentEditor = (typeof supportedDevtoolsComponentEditors)[number];

export const defaultDevtoolsComponentEditor: DevtoolsComponentEditor = "vscode";

export function isDevtoolsComponentEditor(value: unknown): value is DevtoolsComponentEditor {
  return (
    value === "cursor" ||
    value === "vscode" ||
    value === "vscode-insiders" ||
    value === "webstorm"
  );
}

export function readDevtoolsComponentEditorValue(value: unknown): DevtoolsComponentEditor {
  return isDevtoolsComponentEditor(value) ? value : defaultDevtoolsComponentEditor;
}
