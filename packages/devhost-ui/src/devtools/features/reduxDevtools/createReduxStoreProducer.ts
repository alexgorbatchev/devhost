import type { SendProducerMessage } from "./types";
import { stringifyJSON } from "@redux-devtools/app-core";
import { parse } from "jsan";
import { REDUX_INSTRUMENTATION_ERROR } from "./constants";
import { createReduxDevtoolsSchemas } from "./createReduxDevtoolsSchemas";
import { isInstrumentedReduxStore } from "./isInstrumentedReduxStore";
import type { IReduxDevtoolsProducer } from "./types";

export function createReduxStoreProducer(store: unknown, instanceId: string, name: string): IReduxDevtoolsProducer {
  if (!isInstrumentedReduxStore(store)) throw new Error(REDUX_INSTRUMENTATION_ERROR);
  const schemas = createReduxDevtoolsSchemas();
  const publish = (send: SendProducerMessage): void => {
    const state = store.liftedStore.getState();
    send({
      type: "STATE",
      id: instanceId,
      instanceId,
      name,
      payload: stringifyJSON(state, true),
      committedState: stringifyJSON(state.committedState, true),
      libConfig: {
        name,
        type: "redux",
        serialize: true,
        features: {
          jump: true,
          skip: true,
          reorder: true,
          pause: true,
          lock: true,
          export: true,
          import: "custom",
          dispatch: false,
          persist: false,
          sync: false,
          test: false,
        },
      },
    });
  };
  return {
    kind: "redux",
    subscribe: (send) => {
      const unsubscribe = store.liftedStore.subscribe(() => {
        try {
          publish(send);
        } catch (error) {
          send({ type: "ERROR", id: instanceId, message: error instanceof Error ? error.message : String(error) });
        }
      });
      try {
        publish(send);
      } catch (error) {
        unsubscribe();
        throw error;
      }
      return unsubscribe;
    },
    receive: (message) => {
      let action: unknown = message.action;
      if (
        typeof action === "object" &&
        action !== null &&
        "type" in action &&
        action.type === "IMPORT_STATE" &&
        message.state !== undefined
      ) {
        action = { type: "IMPORT_STATE", nextLiftedState: parse(message.state) };
      }
      const parsed = schemas.liftedAction.safeParse(action);
      if (!parsed.success) throw new Error("Unsupported or invalid Redux DevTools lifted action.");
      const lifted = store.liftedStore.getState();
      if (parsed.data.type === "JUMP_TO_STATE" && parsed.data.index >= lifted.computedStates.length)
        throw new Error("Redux history index is out of range.");
      if (
        (parsed.data.type === "JUMP_TO_ACTION" ||
          parsed.data.type === "TOGGLE_ACTION" ||
          parsed.data.type === "REORDER_ACTION") &&
        !lifted.stagedActionIds.includes(parsed.data.type === "TOGGLE_ACTION" ? parsed.data.id : parsed.data.actionId)
      )
        throw new Error("Redux action is absent from the native history.");
      store.liftedStore.dispatch(parsed.data);
    },
  };
}
