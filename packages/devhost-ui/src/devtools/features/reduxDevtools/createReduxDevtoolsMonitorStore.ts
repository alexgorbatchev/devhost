import { coreReducers, getActiveInstance, LIFTED_ACTION, middlewares } from "@redux-devtools/app-core";
import { nonReduxDispatch } from "@redux-devtools/app";
import { applyMiddleware, combineReducers, createStore } from "redux";
import { createReduxDevtoolsSchemas } from "./createReduxDevtoolsSchemas";
import type { CoreStoreAction, CoreStoreState } from "@redux-devtools/app-core";
import type { Middleware, Store } from "redux";
import type { IMonitorDispatch } from "./types";

export function createReduxDevtoolsMonitorStore(
  send: (message: IMonitorDispatch) => void,
): Store<CoreStoreState, CoreStoreAction> {
  const schemas = createReduxDevtoolsSchemas();
  const transport: Middleware<object, CoreStoreState> = (api) => (next) => (action) => {
    const previous = api.getState().instances;
    const result = next(action);
    if (
      typeof action !== "object" ||
      action === null ||
      !("type" in action) ||
      action.type !== LIFTED_ACTION ||
      !("message" in action)
    )
      return result;
    const instances = api.getState().instances;
    const instanceId = String(getActiveInstance(instances));
    if (action.message === "IMPORT" && "state" in action && typeof action.state === "string") {
      send({ type: "DISPATCH", instanceId, action: { type: "IMPORT_STATE" }, state: action.state, isToAll: false });
      return result;
    }
    if (action.message !== "DISPATCH" || !("action" in action)) return result;
    const parsed = schemas.liftedAction.safeParse(action.action);
    if (!parsed.success) return result;
    let state: string | undefined;
    switch (parsed.data.type) {
      case "RESET":
      case "COMMIT":
      case "SET_ACTIONS_ACTIVE":
      case "PERFORM_ACTION":
        break;
      default:
        state = nonReduxDispatch(api, "DISPATCH", instanceId, parsed.data, undefined, previous);
    }
    send({
      type: "DISPATCH",
      instanceId,
      action: parsed.data,
      state,
      isToAll: "toAll" in action && action.toAll === true,
    });
    return result;
  };
  return createStore(
    combineReducers(coreReducers),
    undefined,
    applyMiddleware<CoreStoreAction, CoreStoreState>(...middlewares, transport),
  );
}
