import { formatShortcutLabel } from "../../shared/formatShortcutLabel";

// CodeMirror binds its `Mod` key to Command on Apple platforms and to Control elsewhere.
const commandKeyPlatformPattern = /Mac|iP(hone|[oa]d)/;

/** Labels the editor's save shortcut, `Mod-s`, for the platform the browser reports. */
export function readSaveShortcutLabel(platform: string): string {
  return formatShortcutLabel(commandKeyPlatformPattern.test(platform) ? "meta+s" : "ctrl+s");
}
