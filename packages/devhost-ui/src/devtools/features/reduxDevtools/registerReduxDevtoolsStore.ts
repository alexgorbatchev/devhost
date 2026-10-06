import { createReduxStoreProducer } from "./createReduxStoreProducer";
import { getReduxDevtoolsRegistry } from "./getReduxDevtoolsRegistry";
import type { IReduxDevtoolsRegistrationOptions } from "./types";

export function registerReduxDevtoolsStore(
  options: IReduxDevtoolsRegistrationOptions,
  hostWindow: Window = window,
): () => void {
  const connectionId = hostWindow.crypto.randomUUID();
  return getReduxDevtoolsRegistry(hostWindow).register({
    id: options.id,
    name: options.name,
    connectionId,
    createProducer: () => createReduxStoreProducer(options.store, connectionId, options.name),
  });
}
