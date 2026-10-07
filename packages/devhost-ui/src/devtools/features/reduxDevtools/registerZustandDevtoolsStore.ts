import type { ReduxDevtoolsDispose } from "./types";
import { createZustandStoreProducer } from "./createZustandStoreProducer";
import { getReduxDevtoolsRegistry } from "./getReduxDevtoolsRegistry";
import type { IZustandDevtoolsRegistrationOptions } from "./types";

export function registerZustandDevtoolsStore<State, Snapshot>(
  options: IZustandDevtoolsRegistrationOptions<State, Snapshot>,
  hostWindow: Window = window,
): ReduxDevtoolsDispose {
  const connectionId = hostWindow.crypto.randomUUID();
  return getReduxDevtoolsRegistry(hostWindow).register({
    id: options.id,
    name: options.name,
    connectionId,
    createProducer: () => createZustandStoreProducer(options, connectionId),
  });
}
