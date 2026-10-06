import { createReduxDevtoolsSession } from "./createReduxDevtoolsSession";
import { getReduxDevtoolsRegistry } from "./getReduxDevtoolsRegistry";
import type { IExternalDevtoolsDetector } from "../externalDevtoolsPanel/types";

export function createReduxDevtoolsDetector(hostDocument: Document): IExternalDevtoolsDetector {
  const hostWindow = hostDocument.defaultView;
  if (hostWindow === null) return { readAdapters: () => [], subscribe: () => () => {} };
  const registry = getReduxDevtoolsRegistry(hostWindow);
  const session = createReduxDevtoolsSession(hostWindow, registry);
  return {
    readAdapters: () =>
      registry.read().length === 0
        ? []
        : [
            {
              id: "redux-devtools",
              label: "Redux",
              title: session.readTitle(),
              hideSelectors: [],
              isInstalled: () => registry.read().length > 0,
              isOpen: session.isOpen,
              open: session.open,
              close: session.close,
            },
          ],
    subscribe: session.subscribe,
  };
}
