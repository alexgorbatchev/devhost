import { commands } from "vitest/browser";

import type { INativeBrowserTransportState } from "../../../../../test-support/nativeBrowserTransport";
import type { INativeBrowserObservation } from "../../nativeBrowser/types";

// The control plane these commands reach is `nativeBrowserTransport` in vitest.browser.config.ts: a real HTTP and
// WebSocket endpoint at the test page's own origin, running in the test server's process.
declare module "vitest/browser" {
  interface BrowserCommands {
    acknowledgeNativeBrowserAction: (index: number, revision: number) => Promise<void>;
    readNativeBrowserTransport: () => Promise<INativeBrowserTransportState>;
    resetNativeBrowserTransport: () => Promise<void>;
    sendNativeBrowserObservation: (revision: number, changes: Partial<INativeBrowserObservation>) => Promise<void>;
  }
}

export const hookTransport = {
  /** Answers the page's control request at `index` with a state update at `revision`. */
  acknowledgeAction: (index: number, revision: number): Promise<void> => {
    return commands.acknowledgeNativeBrowserAction(index, revision);
  },
  read: (): Promise<INativeBrowserTransportState> => commands.readNativeBrowserTransport(),
  /** Forgets what the transport has seen. It refuses while a control socket is still open. */
  reset: (): Promise<void> => commands.resetNativeBrowserTransport(),
  /** Sends the page an observation it did not ask for, as the native browser does when its state changes. */
  sendObservation: (revision: number, changes: Partial<INativeBrowserObservation>): Promise<void> => {
    return commands.sendNativeBrowserObservation(revision, changes);
  },
};
