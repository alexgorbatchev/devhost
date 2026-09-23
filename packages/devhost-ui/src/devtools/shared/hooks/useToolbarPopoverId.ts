import { useContext } from "react";

import { toolbarPopoverIdContext } from "../toolbarPopoverIdContext";

/**
 * Returns the id of the enclosing toolbar popover panel. Controls inside a panel pass it as `popoverTarget` with
 * `popoverTargetAction="hide"` to close the panel natively when activated.
 */
export function useToolbarPopoverId(): string | undefined {
  return useContext(toolbarPopoverIdContext) ?? undefined;
}
