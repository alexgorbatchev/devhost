const modifierLabels: Record<string, string> = {
  alt: "Alt",
  cmd: "Meta",
  ctrl: "Ctrl",
  meta: "Meta",
  shift: "Shift",
};

/**
 * Formats a configured shortcut such as `alt+ctrl+r` for display (`Alt+Ctrl+R`). The label is platform-neutral
 * because the shortcut matcher compares the same modifier keys on every platform.
 */
export function formatShortcutLabel(shortcut: string): string {
  return shortcut
    .toLowerCase()
    .split("+")
    .map((part: string): string => {
      const modifierLabel: string | undefined = modifierLabels[part];

      if (modifierLabel !== undefined) {
        return modifierLabel;
      }

      return part.length === 1 ? part.toUpperCase() : `${part.charAt(0).toUpperCase()}${part.slice(1)}`;
    })
    .join("+");
}
