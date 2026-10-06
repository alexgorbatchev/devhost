import { createReduxDevtoolsSchemas } from "./createReduxDevtoolsSchemas";
import type { NativeReduxStore } from "./types";

export function isInstrumentedReduxStore(value: unknown): value is NativeReduxStore {
  if (
    typeof value !== "object" ||
    value === null ||
    !("liftedStore" in value) ||
    !("getState" in value) ||
    typeof value.getState !== "function" ||
    !("subscribe" in value) ||
    typeof value.subscribe !== "function" ||
    !("dispatch" in value) ||
    typeof value.dispatch !== "function"
  )
    return false;
  const lifted = value.liftedStore;
  if (
    typeof lifted !== "object" ||
    lifted === null ||
    !("getState" in lifted) ||
    typeof lifted.getState !== "function" ||
    !("subscribe" in lifted) ||
    typeof lifted.subscribe !== "function" ||
    !("dispatch" in lifted) ||
    typeof lifted.dispatch !== "function"
  )
    return false;
  const state: unknown = lifted.getState();
  return createReduxDevtoolsSchemas().liftedState.safeParse(state).success;
}
