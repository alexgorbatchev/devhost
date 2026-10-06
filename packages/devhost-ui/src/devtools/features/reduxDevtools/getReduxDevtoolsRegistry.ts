import { REDUX_REGISTRY_KEY } from "./constants";
import { createReduxDevtoolsRegistry } from "./createReduxDevtoolsRegistry";
import type { IReduxDevtoolsRegistry } from "./types";

function isRegistry(value: unknown): value is IReduxDevtoolsRegistry {
  return (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    value.version === 1 &&
    "read" in value &&
    typeof value.read === "function" &&
    "register" in value &&
    typeof value.register === "function" &&
    "subscribe" in value &&
    typeof value.subscribe === "function"
  );
}

export function getReduxDevtoolsRegistry(hostWindow: Window): IReduxDevtoolsRegistry {
  const existing: unknown = Reflect.get(hostWindow, REDUX_REGISTRY_KEY);
  if (existing !== undefined) {
    if (!isRegistry(existing))
      throw new Error("The devhost Redux registration API is unavailable: its window namespace is already occupied.");
    return existing;
  }
  const registry = createReduxDevtoolsRegistry();
  Object.defineProperty(hostWindow, REDUX_REGISTRY_KEY, { value: registry, configurable: false, writable: false });
  return registry;
}
