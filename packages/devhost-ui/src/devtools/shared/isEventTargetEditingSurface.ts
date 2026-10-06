/**
 * Whether a keystroke aimed at `target` belongs to an editing surface: a form control, editable content, or a
 * terminal. Devtools shortcuts leave those keystrokes to the surface.
 */
export function isEventTargetEditingSurface(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  return (
    target.matches("input, textarea, select") ||
    (target instanceof HTMLElement && target.isContentEditable) ||
    target.closest(".xterm, [contenteditable]") !== null
  );
}
