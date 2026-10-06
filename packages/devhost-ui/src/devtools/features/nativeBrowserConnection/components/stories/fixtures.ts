import { createNativeBrowserView } from "../../../../shared/nativeBrowser/createNativeBrowserView";
import type { INativeBrowserObservation, INativeBrowserView } from "../../../../shared/nativeBrowser/types";

export function factory_nativeBrowserView(changes: Partial<INativeBrowserObservation>): INativeBrowserView {
  return {
    ...createNativeBrowserView(),
    connectionStatus: "connected",
    observation: {
      isConnected: true,
      documentState: "bound",
      isReactAvailable: false,
      isNativeWindowOpen: false,
      isNativeSessionLost: false,
      browserVersion: "Chrome/154.0.8037.92",
      message: "React Developer Tools 8.0.0 is missing, disabled, suspended, or unverified in this browser.",
      ...changes,
    },
  };
}
