import type { INativeBrowserView } from "./types";

export function createNativeBrowserView(): INativeBrowserView {
  return {
    connectionStatus: "disconnected",
    observation: null,
    isActionPending: false,
    errorMessage: null,
    binding: null,
  };
}
