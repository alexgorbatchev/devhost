import { createContext } from "react";

// The id of the enclosing toolbar popover panel, so controls inside it can close it declaratively with
// `popoverTarget={id} popoverTargetAction="hide"`.
export const toolbarPopoverIdContext = createContext<string | null>(null);
